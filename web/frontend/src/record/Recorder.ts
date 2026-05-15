interface RecorderOptions {

    sampleRate: number;
    channels: number;

}

export type RecorderStatus = "idle" | "recording" | "finalising" | "error";

// Polyfill for the File System Access API.

interface SaveFilePickerType {

    description?: string;
    accept: Record<string, string[]>;

}

interface SaveFilePickerOptions {

    suggestedName?: string;
    types?: SaveFilePickerType[];

}

declare global {

    interface Window {

        showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;

    }

}

export function isFileSystemAccessSupported(): boolean {

    return typeof window !== "undefined" && typeof window.showSaveFilePicker === "function";

}

export class Recorder {

    private handle: FileSystemFileHandle | null = null;
    private writable: FileSystemWritableFileStream | null = null;
    private chain: Promise<void> = Promise.resolve();
    private bytesWritten = 0;
    private status: RecorderStatus = "idle";

    constructor(private readonly options: RecorderOptions) {}

    getStatus(): RecorderStatus { return this.status; }

    getBytesWritten(): number { return this.bytesWritten; }

    async start(): Promise<void> {

        if (!isFileSystemAccessSupported()) {

            throw new Error("File System Access API is not available — use Chrome or Edge to record to disk.");

        }

        const picker = window.showSaveFilePicker!;

        const handle = await picker({

            suggestedName: `echo-session-${new Date().toISOString().replace(/[:.]/g, "-")}.pcm`,
            types: [
                {
                    description: "Raw little-endian int16 stereo 48 kHz PCM",
                    accept: { "application/octet-stream": [".pcm", ".raw"] },
                },
            ],

        });

        const writable = await handle.createWritable();

        this.handle = handle;
        this.writable = writable;
        this.bytesWritten = 0;
        this.chain = Promise.resolve();
        this.status = "recording";

    }

    // appendFrame queues an immutable copy of the frame for writing.
    appendFrame(bytes: Uint8Array): void {

        if (this.status !== "recording" || !this.writable) {

            return;

        }

        const writable = this.writable;

        const owned = bytes.slice();

        this.bytesWritten += owned.byteLength;

        // Chain writes so they apply in order, but don't block the caller.
        this.chain = this.chain.then(() => writable.write(owned)).catch((err) => {

            console.error("Recorder write failed:", err);

            this.status = "error";

        });

    }

    async stop(): Promise<void> {

        if (this.status !== "recording" || !this.writable) {

            return;

        }

        this.status = "finalising";

        // Makes sure every queued frame finished writing before we patch.

        await this.chain;

        const writable = this.writable;

        await writable.close();

        this.writable = null;

        await this.offerWavCopy();

        this.status = "idle";

    }

    // offerWavCopy reads the saved raw PCM back from disk, wraps it with a WAV header, and offers it as a download.
    private async offerWavCopy(): Promise<void> {

        if (!this.handle) {

            return;

        }

        const file = await this.handle.getFile();
        const rawBuffer = await file.arrayBuffer();
        const raw = new Uint8Array(rawBuffer);

        const wav = wrapAsWav(raw, this.options.sampleRate, this.options.channels);

        // wav.buffer is a fresh ArrayBuffer from wrapAsWav

        const blob = new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");

        link.href = url;
        link.download = file.name.replace(/\.(pcm|raw)$/i, "") + ".wav";

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        setTimeout(() => URL.revokeObjectURL(url), 30_000); // defers the revoke to ensure the download has started

    }

}

// wrapAsWav prepends the canonical 44-byte RIFF header to a raw int16 LE PCM payload.
function wrapAsWav(pcm: Uint8Array, sampleRate: number, channels: number): Uint8Array {

    const bitsPerSample = 16;
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);

    const buffer = new ArrayBuffer(44 + pcm.byteLength);
    const view = new DataView(buffer);

    let offset = 0;

    const writeStr = (s: string) => {

        for (let i = 0; i < s.length; i++) {

            view.setUint8(offset++, s.charCodeAt(i));

        }

    };

    writeStr("RIFF");
    view.setUint32(offset, 36 + pcm.byteLength, true); offset += 4;
    writeStr("WAVE");

    writeStr("fmt ");
    view.setUint32(offset, 16, true); offset += 4; // chunk size
    view.setUint16(offset, 1, true); offset += 2; // PCM = 1
    view.setUint16(offset, channels, true); offset += 2;
    view.setUint32(offset, sampleRate, true); offset += 4;
    view.setUint32(offset, byteRate, true); offset += 4;
    view.setUint16(offset, blockAlign, true); offset += 2;
    view.setUint16(offset, bitsPerSample, true); offset += 2;

    writeStr("data");
    view.setUint32(offset, pcm.byteLength, true); offset += 4;

    new Uint8Array(buffer, 44).set(pcm);

    return new Uint8Array(buffer);

}
