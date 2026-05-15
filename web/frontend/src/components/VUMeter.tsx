import { Component, createRef, type RefObject } from "react";

interface Props {

    analyser: AnalyserNode | null;

}

interface State {

    levelDb: number;

}

// VUMeter renders a sample bar driven by an AnalyserNode.
export class VUMeter extends Component<Props, State> {

    private canvasRef: RefObject<HTMLCanvasElement | null> = createRef<HTMLCanvasElement>();
    private buffer: Uint8Array<ArrayBuffer> | null = null;
    private rafId: number | null = null;

    state: State = { levelDb: -60 };

    componentDidMount(): void {

        this.loop();

    }

    componentDidUpdate(prev: Props): void {

        if (prev.analyser !== this.props.analyser) {

            this.buffer = null;

        }

    }

    componentWillUnmount(): void {

        if (this.rafId !== null) {

            cancelAnimationFrame(this.rafId);
            this.rafId = null;

        }

    }

    private loop = (): void => {

        this.rafId = requestAnimationFrame(this.loop);

        this.draw();

    };

    private draw(): void {

        const canvas = this.canvasRef.current;
        const analyser = this.props.analyser;

        if (!canvas) return;

        const ctx = canvas.getContext("2d");

        if (!ctx) return;

        const { width, height } = canvas;

        ctx.fillStyle = "#09090b";
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.lineWidth = 1;

        for (let db = -50; db <= 0; db += 10) {

            const x = Math.round(((db + 60) / 60) * width);

            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();

        }

        if (!analyser) return;

        if (!this.buffer || this.buffer.length !== analyser.fftSize) {

            this.buffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));

        }

        analyser.getByteTimeDomainData(this.buffer);

        let peak = 0;

        for (let i = 0; i < this.buffer.length; i++) {

            const sample = Math.abs(this.buffer[i] - 128) / 128;

            if (sample > peak) peak = sample;

        }

        const peakDb = peak > 0 ? 20 * Math.log10(peak) : -60;
        const clamped = Math.max(-60, Math.min(0, peakDb));
        const ratio = (clamped + 60) / 60;
        const barWidth = ratio * width;

        const grad = ctx.createLinearGradient(0, 0, width, 0);
        grad.addColorStop(0, "rgba(63, 63, 70, 0.95)");
        grad.addColorStop(0.65, "rgba(212, 212, 216, 0.9)");
        grad.addColorStop(0.9, "rgba(250, 250, 250, 1)");
        grad.addColorStop(0.97, "rgba(255, 255, 255, 1)");

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, barWidth, height);

        if (Math.abs(this.state.levelDb - clamped) > 0.5) {

            this.setState({ levelDb: clamped });

        }

    }

    render() {

        const dbLabel = this.state.levelDb.toFixed(1) + " dBFS";

        return (

            <div className="flex w-full flex-col gap-2">

                <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.06em] text-fg-subtle">

                    <span>Level</span>

                    <span className="tabular-nums">{dbLabel}</span>

                </div>

                <div className="overflow-hidden border border-border bg-surface-inset">

                    <canvas ref={this.canvasRef} width={800} height={52} className="block h-[52px] w-full" />

                </div>

            </div>

        );

    }

}
