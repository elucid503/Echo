declare const registerProcessor: ( name: string, ctor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor) => void;

declare class AudioWorkletProcessor {

    readonly port: MessagePort;

    constructor();

    process(

        inputs: Float32Array[][],
        outputs: Float32Array[][],
        parameters: Record<string, Float32Array>

    ): boolean;

}

const RING_CAPACITY = 48000; // 48 kHz * 2 channels * 0.5 s = 48000 samples interleaved.

const TARGET_FILL = (48000 / 1000) * 200;
const MAX_FILL = (48000 / 1000) * 400;

class EchoPcmPlayer extends AudioWorkletProcessor {

    // Interleaved Float32 ring buffer. Holds samples-per-channel * channels.

    private ring = new Float32Array(RING_CAPACITY * 2);
    private writePos = 0;
    private readPos = 0;
    private filled = 0;

    // If prerolling, the output is silent until the jitter buffer reaches TARGET_FILL.

    private prerolling = true;

    constructor() {

        super();

        this.port.onmessage = (event) => this.onMessage(event);

    }

    private onMessage(event: MessageEvent): void {

        const data = event.data as { pcm?: Int16Array } | null;

        if (!data || !data.pcm) {

            return;

        }

        this.push(data.pcm);

    }

    private push(int16: Int16Array): void {

        const ring = this.ring;
        const total = ring.length;

        for (let i = 0; i < int16.length; i++) {

            ring[this.writePos] = int16[i] / 32768;

            this.writePos++;

            if (this.writePos >= total) {

                this.writePos = 0;

            }

            if (this.filled < total) {

                this.filled++;

            } else {

                // Ring overflow. We should rop the oldest sample so we never block.

                this.readPos++;

                if (this.readPos >= total) {

                    this.readPos = 0;

                }

            }

        }

        // If latency is too high, we drop the oldest samples to get back to TARGET_FILL.

        if (this.filled > MAX_FILL * 2) {

            const drop = this.filled - TARGET_FILL * 2;

            this.readPos = (this.readPos + drop) % total;
            this.filled -= drop;

        }

    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {

        const output = outputs[0];

        if (!output || output.length < 2) {

            return true;

        }

        const left = output[0];
        const right = output[1];

        // Holds playback in silence until the jitter buffer reaches TARGET_FILL.

        if (this.prerolling) {

            if (this.filled < TARGET_FILL * 2) {

                left.fill(0);
                right.fill(0);
                return true;

            }

            this.prerolling = false;

        }

        // If we can't fill the output, we should output silence and wait for the jitter buffer to fill up again.

        if (this.filled < left.length * 2) {

            this.readPos = this.writePos;

            this.filled = 0;
            this.prerolling = true;

            left.fill(0);
            right.fill(0);

            return true;

        }

        const ring = this.ring;
        const total = ring.length;

        for (let i = 0; i < left.length; i++) {

            left[i] = ring[this.readPos];
            this.readPos = (this.readPos + 1) % total;

            right[i] = ring[this.readPos];
            this.readPos = (this.readPos + 1) % total;

            this.filled -= 2;

        }

        return true;

    }

}

registerProcessor("echo-pcm-player", EchoPcmPlayer);
