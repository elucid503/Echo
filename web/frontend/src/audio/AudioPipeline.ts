import workletUrl from "./worklet.ts?worker&url";

export type PipelineState = "idle" | "starting" | "running" | "suspended";

export class AudioPipeline {

	public readonly sampleRate = 48000;

	private context: AudioContext | null = null;
	private workletNode: AudioWorkletNode | null = null;
	private analyser: AnalyserNode | null = null;
	private state: PipelineState = "idle";

	// Starts (or resumes) the audio graph. Must be called from a user gesture!

	async start(): Promise<void> {

		if (this.state === "running") {

			return;

		}

		if (!this.context) {

			this.state = "starting";

			this.context = new AudioContext({ sampleRate: this.sampleRate });

			await this.context.audioWorklet.addModule(workletUrl);

			this.workletNode = new AudioWorkletNode(this.context, "echo-pcm-player", {

				numberOfInputs: 0,
				numberOfOutputs: 1,
				outputChannelCount: [2],

			});

			this.analyser = this.context.createAnalyser();
			this.analyser.fftSize = 2048;
			this.analyser.smoothingTimeConstant = 0.4;

			this.workletNode.connect(this.analyser);
			this.analyser.connect(this.context.destination);

		}

		if (this.context.state === "suspended") {

			await this.context.resume();

		}

		this.state = "running";

	}

	async suspend(): Promise<void> {

		if (this.context && this.context.state === "running") {

			await this.context.suspend();

		}

		this.state = "suspended";

	}

	// pushFrame hands an Int16Array to the worklet.

	pushFrame(int16: Int16Array): void {

		if (!this.workletNode) {

			return;

		}

		this.workletNode.port.postMessage({ pcm: int16 }, [int16.buffer]);

	}

	getAnalyser(): AnalyserNode | null { return this.analyser; }

	getState(): PipelineState { return this.state; }

	async dispose(): Promise<void> {

		if (this.workletNode) {

			this.workletNode.disconnect();
			this.workletNode = null;

		}

		if (this.analyser) {

			this.analyser.disconnect();
			this.analyser = null;

		}

		if (this.context) {

			await this.context.close();
			this.context = null;

		}

		this.state = "idle";

	}

}
