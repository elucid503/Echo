import { Component, createRef } from "react";

// Tailwind-specific stuff

const panelClass ="flex flex-col gap-5 border border-border bg-surface p-5";
const panelTitleClass = "mb-0 text-[11px] font-semibold uppercase tracking-[0.07em] text-fg-subtle";
const primaryBtnClass = "rounded-none cursor-pointer border-0 bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryBtnClass = "rounded-none cursor-pointer border border-border-strong bg-surface-raised px-4 py-2 text-sm font-semibold text-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const dangerBtnClass = "rounded-none cursor-pointer border border-border-strong bg-fg px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90";
const nudgeBtnClass = "rounded-none cursor-pointer border border-border bg-surface-inset px-2 py-1 font-mono text-[10px] text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-40";

type SyncState = "idle" | "previewing" | "exporting";

interface State {

    videoFile: File | null;
    wavFile: File | null;

    videoUrl: string | null;

    offset: number;
    syncState: SyncState;

    exportProgress: number;

    videoDuration: number;
    wavDuration: number;

    error: string | null;

}

export class VideoSync extends Component<Record<string, never>, State> {

    private videoRef = createRef<HTMLVideoElement>();
    private waveformRef = createRef<HTMLCanvasElement>();

    private sharedCtx: AudioContext | null = null; // Singleton for the entire component
    private videoMediaSrc: MediaElementAudioSourceNode | null = null;

    private wavBuffer: AudioBuffer | null = null;
    private wavSource: AudioBufferSourceNode | null = null;
    private mediaRecorder: MediaRecorder | null = null;
    private exportChunks: BlobPart[] = [];
    private progressTimer: number | null = null;
    private videoObjectUrl: string | null = null;

    state: State = {

        videoFile: null,
        wavFile: null,

        videoUrl: null,

        offset: 0,
        syncState: "idle",

        exportProgress: 0,

        videoDuration: 0,
        wavDuration: 0,

        error: null,

    };

    componentWillUnmount(): void {

        this.stopSession(true); // cancels recorder without triggering download

        if (this.sharedCtx) { void this.sharedCtx.close(); this.sharedCtx = null; }
        if (this.videoObjectUrl) URL.revokeObjectURL(this.videoObjectUrl);

    }

    // Tears down the current preview/export without closing the shared AudioContext.

    private stopSession(cancelRecorder = false): void {

        if (this.progressTimer !== null) { clearInterval(this.progressTimer); this.progressTimer = null; }

        if (this.wavSource) {

            try { this.wavSource.stop(); } catch { /* already ended */ }

            this.wavSource.disconnect();
            this.wavSource = null;

        }

        if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {

            if (cancelRecorder) this.mediaRecorder.onstop = null;
            this.mediaRecorder.stop();

        }

        this.mediaRecorder = null;

        if (this.videoMediaSrc) this.videoMediaSrc.disconnect(); // Disconnect videoMediaSrc so it can be re-routed on the next session.

        if (this.sharedCtx?.state === "running") void this.sharedCtx.suspend(); // voids to ignore promise rejections if already suspended elsewhere

        const video = this.videoRef.current;

        if (video) {

          video.pause();

          video.muted = false;
          video.onended = null;

        }

    }

    // Returns the shared AudioContext and the video's MediaElementAudioSourceNode, creating them on first call.

    private async ensureCtx(): Promise<{ ctx: AudioContext; videoSrc: MediaElementAudioSourceNode }> {

        const video = this.videoRef.current;
        if (!video) throw new Error("Video element not mounted.");

        if (this.sharedCtx?.state === "closed") {

            this.sharedCtx = null;
            this.videoMediaSrc = null;

        }

        if (!this.sharedCtx) this.sharedCtx = new AudioContext({ sampleRate: 48000 });
        if (this.sharedCtx.state === "suspended") await this.sharedCtx.resume();
        if (!this.videoMediaSrc) this.videoMediaSrc = this.sharedCtx.createMediaElementSource(video);

        return { ctx: this.sharedCtx, videoSrc: this.videoMediaSrc };

    }


    private handleVideoFile(file: File): void {

        if (this.videoObjectUrl) URL.revokeObjectURL(this.videoObjectUrl);

        const url = URL.createObjectURL(file);
        this.videoObjectUrl = url;

        this.setState({ videoFile: file, videoUrl: url, videoDuration: 0, error: null });

    }

    private handleWavFile = async (file: File): Promise<void> => {

        this.setState({ wavFile: file, error: null, wavDuration: 0 });

        try {

            const buf = await file.arrayBuffer();
            const tmp = new AudioContext();
            const decoded = await tmp.decodeAudioData(buf);

            await tmp.close();

            this.wavBuffer = decoded;

            this.setState({ wavDuration: decoded.duration });

            requestAnimationFrame(() => this.drawWaveform(decoded));

        } catch (e) {

            this.wavBuffer = null;
            this.setState({ error: `Could not decode audio: ${e instanceof Error ? e.message : String(e)}` });

        }

    };

    private drawWaveform(buffer: AudioBuffer): void {

        const canvas = this.waveformRef.current;
        if (!canvas) return;

        const width = canvas.clientWidth || 600;
        const height = 52;
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d");
        if (!context) return;

        context.fillStyle = "#0c0c0e";
        context.fillRect(0, 0, width, height);

        // Centre line

        context.strokeStyle = "#27272a";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(0, height / 2);
        context.lineTo(width, height / 2);
        context.stroke();

        const data = buffer.getChannelData(0);
        const step = Math.ceil(data.length / width);
        const midline = height / 2;

        context.strokeStyle = "#52525b";
        context.lineWidth = 1;

        for (let x = 0; x < width; x++) {

            let lo = 0;
            let hi = 0;

            const base = x * step;

            for (let i = 0; i < step && base + i < data.length; i++) {

                const sample = data[base + i] ?? 0;

                if (sample < lo) lo = sample;
                if (sample > hi) hi = sample;

            }

            context.beginPath();

            context.moveTo(x + 0.5, midline + lo * midline * 0.88);
            context.lineTo(x + 0.5, midline + hi * midline * 0.88);

            context.stroke();

        }

    }

    private handleVideoDurationChange = (): void => {

        const video = this.videoRef.current;
        if (video && isFinite(video.duration)) this.setState({ videoDuration: video.duration });

    };

    private nudgeOffset = (delta: number): void => {

        this.setState(({ offset }) => ({

            offset: Math.min(120, Math.max(-120, +(offset + delta).toFixed(1))),

        }));

    };

    private scheduleAudio(ctx: AudioContext, buffer: AudioBuffer, offset: number): AudioBufferSourceNode {

        const source = ctx.createBufferSource();

        source.buffer = buffer;

        const bufOffset = Math.min(Math.max(0, -offset), buffer.duration);
        const startAt = ctx.currentTime + 0.1 + Math.max(0, offset);

        source.start(startAt, bufOffset);

        return source;

    }

    private startPreview = async (): Promise<void> => {

        const video = this.videoRef.current;
        if (!video || !this.wavBuffer) return;

        this.stopSession(true);
        this.setState({ syncState: "previewing", error: null });

        try {

            const { ctx, videoSrc } = await this.ensureCtx();

            const wavSrc = this.scheduleAudio(ctx, this.wavBuffer, this.state.offset);
            this.wavSource = wavSrc;

            videoSrc.connect(ctx.destination);
            wavSrc.connect(ctx.destination);

            video.currentTime = 0;

            await video.play();

            video.onended = () => this.stopPreview();

        } catch (e) {

            this.stopSession(true);
            this.setState({ syncState: "idle", error: `Preview failed: ${e instanceof Error ? e.message : String(e)}` });

        }

    };

    private stopPreview = (): void => {

        this.stopSession(true);
        this.setState({ syncState: "idle" });

    };

    private startExport = async (): Promise<void> => {

        const video = this.videoRef.current;
        if (!video || !this.wavBuffer) return;

        this.stopSession(true);
        this.setState({ syncState: "exporting", exportProgress: 0, error: null });

        try {

            const { ctx, videoSrc } = await this.ensureCtx();

            const dest = ctx.createMediaStreamDestination();
            const wavSrc = this.scheduleAudio(ctx, this.wavBuffer, this.state.offset);

            this.wavSource = wavSrc;

            videoSrc.connect(dest);
            wavSrc.connect(dest);

            const el = video as unknown as { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream };
            const raw = (el.captureStream ?? el.mozCaptureStream)?.call(el);

            if (!raw) throw new Error("captureStream() is not supported — use Chrome or Edge.");

            const videoTracks = raw.getVideoTracks();
            if (videoTracks.length === 0) throw new Error("No video track — try a different file format (MP4/WebM with H.264 or VP9).");

            const combined = new MediaStream([...videoTracks, ...dest.stream.getAudioTracks()]);

            const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";

            const recorder = new MediaRecorder(combined, { mimeType });

            this.mediaRecorder = recorder;
            this.exportChunks = [];

            recorder.ondataavailable = (e) => {

                if (e.data.size > 0) this.exportChunks.push(e.data);

            };

            recorder.onstop = () => {

                const blob = new Blob(this.exportChunks, { type: "video/webm" });
                const url = URL.createObjectURL(blob);
                const link = Object.assign(document.createElement("a"), { href: url, download: `echo-synced-${Date.now()}.webm` });

                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                setTimeout(() => URL.revokeObjectURL(url), 30_000);

                void ctx.suspend();

                this.setState({ syncState: "idle", exportProgress: 1 });

            };

            video.muted = true;
            video.currentTime = 0;

            recorder.start(500);
            await video.play();

            this.progressTimer = window.setInterval(() => {

                if (video.duration > 0) this.setState({ exportProgress: video.currentTime / video.duration });

            }, 250);

            video.onended = () => {

                if (this.progressTimer !== null) {

                    clearInterval(this.progressTimer);
                    this.progressTimer = null;

                }

                try {

                    this.wavSource?.stop();

                } catch {

                    // already ended, no-op

                }

                recorder.stop();

            };

        } catch (e) {

            this.stopSession(true);
            this.setState({ syncState: "idle", error: `Export failed: ${e instanceof Error ? e.message : String(e)}` });

        }

    };

    private stopExport = (): void => {

        // Cancels without downloading partial output.

        this.stopSession(true);
        this.setState({ syncState: "idle" });

    };

    render() {

        const {

            videoFile, wavFile, videoUrl, offset,
            syncState, exportProgress, videoDuration, wavDuration, error,

        } = this.state;

        const idle = syncState === "idle";
        const isPreviewing = syncState === "previewing";
        const isExporting = syncState === "exporting";
        const hasVideo = !!videoUrl;
        const hasWav = !!this.wavBuffer;
        const canAct = hasVideo && hasWav && idle;

        // Shared timeline coordinate system for both tracks.

        const tStart = Math.min(0, offset);
        const tEnd = Math.max(videoDuration, offset + wavDuration, 0.001);
        const tRange = tEnd - tStart || 0.001;

        const toPct = (abs: number) => `${((abs - tStart) / tRange * 100).toFixed(3)}%`;
        const toWPct = (dur: number) => `${(dur / tRange * 100).toFixed(3)}%`;

        return (

            <div className={panelClass}>

                <div className="flex items-start justify-between gap-4">

                    <div>

                        <p className={panelTitleClass}>Video Sync</p>
                        <p className="mt-1 text-[11px] leading-relaxed text-fg-subtle">
                            Sync a call recording to gameplay footage and export as a single file — no upload, everything runs in-browser.
                        </p>

                    </div>

                    {isExporting && (

                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-muted">

                            {Math.round(exportProgress * 100)}%

                        </span>

                    )}

                    {isPreviewing && (

                        <span className="shrink-0 text-[11px] text-fg-muted">Previewing...</span>

                    )}

                </div>

                <div className="grid grid-cols-2 gap-3">

                    <DropZone label="Video file" accept="video/*" file={videoFile} icon={<VideoIcon />} hint="Drop or click to upload" onFile={(f) => this.handleVideoFile(f)}/>

                    <DropZone label="Call recording (WAV)" accept="audio/*,.wav" file={wavFile} icon={<AudioIcon />} hint="Drop or click to upload" onFile={(f) => void this.handleWavFile(f)}/>

                </div>

                {hasVideo && (

                    <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 228px" }}>

                        <video ref={this.videoRef} src={videoUrl!} className="w-full border border-border bg-black" style={{ maxHeight: "230px", objectFit: "contain" }} onDurationChange={this.handleVideoDurationChange} controls={idle} playsInline preload="metadata"/>

                        <div className="flex flex-col gap-3">

                            {/* Waveform */}

                            {wavFile && (

                                <div className="flex flex-col gap-1.5">

                                    <span className="text-[10px] uppercase tracking-widest text-fg-subtle">Waveform</span>

                                    <canvas ref={this.waveformRef} className="w-full border border-border" style={{ height: "52px", display: "block" }}/>

                                </div>

                            )}

                            {/* Duration */}

                            <div className="flex flex-col gap-1">

                                {videoDuration > 0 && <InfoRow label="Video" value={fmtDur(videoDuration)} />}
                                {wavDuration > 0 && <InfoRow label="Audio" value={fmtDur(wavDuration)} />}

                                <InfoRow label="Offset" value={`${offset >= 0 ? "+" : ""}${offset.toFixed(1)}s`} dim={offset === 0} />

                            </div>

                        </div>

                    </div>
                )}

                {videoDuration > 0 && wavDuration > 0 && (

                    <div className="flex flex-col gap-2">

                        <span className="text-[10px] uppercase tracking-widest text-fg-subtle">Timeline</span>

                        <div className="flex flex-col gap-1.5">

                            <div className="flex items-center gap-2">

                                <span className="w-9 shrink-0 text-right text-[9px] uppercase tracking-widest text-fg-subtle">

                                    video

                                </span>

                                <div className="relative h-2 flex-1 bg-surface-inset">

                                    <div className="absolute inset-y-0 bg-border-strong" style={{ left: toPct(0), width: toWPct(videoDuration) }}/>

                                </div>

                            </div>

                            <div className="flex items-center gap-2">

                                <span className="w-9 shrink-0 text-right text-[9px] uppercase tracking-widest text-fg-subtle">

                                    audio

                                </span>

                                <div className="relative h-2 flex-1 bg-surface-inset">

                                    <div className="absolute inset-y-0 bg-accent" style={{ left: toPct(offset), width: toWPct(wavDuration) }}/>

                                </div>

                            </div>

                        </div>

                    </div>

                )}

                {hasVideo && (

                    <div className="flex flex-col gap-2.5">

                        <div className="flex items-center justify-between">

                            <span className="text-[10px] uppercase tracking-widest text-fg-subtle">Audio offset</span>
                            <span className="font-mono text-xs tabular-nums text-fg"> {offset >= 0 ? "+" : ""}{offset.toFixed(1)}s </span>

                        </div>

                        <input type="range" min="-120" max="120" step="0.1" value={offset} onChange={(e) => this.setState({ offset: parseFloat(e.target.value) })} disabled={!idle} className="w-full cursor-pointer accent-[#e4e4e7] disabled:cursor-not-allowed"/>

                        {/* Nudge buttons */}

                        <div className="flex items-center gap-1">

                            {([-10, -1, -0.1] as const).map((d) => (

                              <button key={d} type="button" disabled={!idle} onClick={() => this.nudgeOffset(d)} className={nudgeBtnClass}>

                                {d}s

                              </button>

                            ))}

                            <div className="flex-1" />

                                {([0.1, 1, 10] as const).map((d) => (

                                  <button key={d} type="button" disabled={!idle} onClick={() => this.nudgeOffset(d)} className={nudgeBtnClass} >

                                    +{d}s

                                  </button>

                                ))}

                            </div>

                        <div className="flex justify-between text-[10px] text-fg-subtle">

                            <span>← audio earlier</span>
                            <span>audio later →</span>

                        </div>

                    </div>

                )}

                {isExporting && (

                    <div className="h-px w-full overflow-hidden bg-border">

                        <div className="h-full bg-accent transition-all duration-200" style={{ width: `${Math.round(exportProgress * 100)}%` }}/>

                    </div>
                )}


                {hasVideo && (

                    <div className="flex items-center gap-2">

                        {isPreviewing ? (

                            <button type="button" onClick={this.stopPreview} className={dangerBtnClass}>

                                Stop Preview

                            </button>

                        ) : isExporting ? (

                            <button type="button" onClick={this.stopExport} className={dangerBtnClass}>

                                Cancel

                            </button>

                        ) : (

                            <>

                                <button type="button" onClick={this.startPreview} disabled={!canAct} className={secondaryBtnClass}>

                                    Preview Sync

                                </button>

                                <button type="button" onClick={this.startExport} disabled={!canAct} className={primaryBtnClass}>

                                    Export

                                </button>

                            </>

                        )}

                        {!hasWav && idle && (

                            <span className="ml-1 text-[11px] text-fg-subtle">

                                Upload a call recording to continue.

                            </span>

                        )}

                    </div>
                )}

                {error && (

                    <p className="border border-border-strong bg-surface-inset px-3 py-2 text-[11px] leading-relaxed text-danger">

                        {error}

                    </p>

                )}

            </div>

        );

    }

}

// Helpers

interface DropZoneProps {

    label: string;
    accept: string;

    file: File | null;

    icon: React.ReactNode;
    hint: string;

    onFile: (f: File) => void;

}

function DropZone({ label, accept, file, icon, hint, onFile }: DropZoneProps) {

  return (

    <div className="flex flex-col gap-1.5">

      <span className="text-[10px] uppercase tracking-widest text-fg-subtle">{label}</span>

          <label className={`relative flex min-h-[72px] cursor-pointer flex-col items-center justify-center gap-2 border border-dashed px-4 py-4 transition-colors select-none ${file ? "border-border-strong bg-surface-raised" : "border-border bg-surface-inset hover:border-fg-subtle hover:bg-surface"}`}

            onDrop={(e) => {

                e.preventDefault();

                const f = e.dataTransfer.files[0];
                if (f) onFile(f);

              }}

              onDragOver={(e) => e.preventDefault()}

          >

            <input type="file" accept={accept} className="absolute inset-0 h-full w-full cursor-pointer opacity-0"

                onChange={(e) => {

                  const f = e.target.files?.[0];

                  if (f) {

                    onFile(f);
                    e.target.value = "";

                  }

                }}
            />

              {file ? (

                  <div className="flex items-center gap-2">

                      <CheckIcon />
                      <span className="max-w-[180px] truncate text-xs text-fg">{file.name}</span>

                  </div>

              ) : (<>

                      {icon}
                      <span className="text-[11px] text-fg-subtle">{hint}</span>

                  </>

              )}

          </label>

      </div>

    );
}

function InfoRow({ label, value, dim }: { label: string; value: string; dim?: boolean }) {

    return (

        <div className="flex justify-between text-[11px]">

            <span className="text-fg-subtle">{label}</span>
            <span className={`font-mono tabular-nums ${dim ? "text-fg-subtle" : "text-fg"}`}>{value}</span>

        </div>

    );

}

function fmtDur(s: number): string {

    const m = Math.floor(s / 60);
    return `${m}:${Math.floor(s % 60).toString().padStart(2, "0")}`;

}

function CheckIcon() {

  return (

        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg-muted">

          <path d="M20 6 9 17l-5-5" />

        </svg>

    );

}

function VideoIcon() {

    return (

        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-fg-subtle">

            <rect x="2" y="6" width="15" height="12" rx="1" />
            <path d="m17 10 5-3v10l-5-3V10Z" />

        </svg>

    );
}

function AudioIcon() {

    return (

        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-fg-subtle">

            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />

        </svg>

    );

}
