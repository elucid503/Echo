import { Component } from "react";

import { AudioPipeline } from "./audio/AudioPipeline";
import { EchoSocket, type SocketStatus } from "./net/EchoSocket";
import { Recorder, type RecorderStatus } from "./record/Recorder";
import { Controls } from "./components/Controls";
import { StatusBar, type ServerStatus } from "./components/StatusBar";
import { VUMeter } from "./components/VUMeter";
import { VideoSync } from "./components/VideoSync";

const STATUS_POLL_MS = 2000;

interface Props {

    guildID: string;

}

interface State {

    socketStatus: SocketStatus;
    serverStatus: ServerStatus | null;
    playing: boolean;
    clipSeconds: number;
    clipBusy: boolean;
    recorderStatus: RecorderStatus;
    analyser: AnalyserNode | null;
    errorMessage: string | null;

}

// Dashboard acts as a mediator for the three long-lived helpers (WebSocket, audio pipeline, recorder) for a single guild.
export class Dashboard extends Component<Props, State> {

    private pipeline = new AudioPipeline();

    private recorder = new Recorder({ sampleRate: 48000, channels: 2 });

    private socket: EchoSocket;

    private pollTimer: number | null = null;

    state: State = {

        socketStatus: "disconnected",
        serverStatus: null,
        playing: false,
        clipSeconds: 15,
        clipBusy: false,
        recorderStatus: "idle",
        analyser: null,
        errorMessage: null,

    };

    constructor(props: Props) {

        super(props);

        this.socket = new EchoSocket({

            guildID: props.guildID,
            onFrame: (frame) => this.handleFrame(frame),
            onStatus: (status) => this.setState({ socketStatus: status }),

        });

    }

    componentDidMount(): void {

        this.socket.connect();

        void this.refreshStatus();

        this.pollTimer = window.setInterval(() => void this.refreshStatus(), STATUS_POLL_MS);

    }

    componentWillUnmount(): void {

        this.socket.disconnect();

        if (this.pollTimer !== null) {

            window.clearInterval(this.pollTimer);
            this.pollTimer = null;

        }

        void this.pipeline.dispose();

    }

    // handleFrame splits work between the audio worklet and the recorder.
    private handleFrame(frame: ArrayBuffer): void {

        if (this.recorder.getStatus() === "recording") {

            this.recorder.appendFrame(new Uint8Array(frame));

        }

        this.pipeline.pushFrame(new Int16Array(frame));

    }

    private async refreshStatus(): Promise<void> {

        try {

            const res = await fetch(`/status?guildID=${this.props.guildID}`, { cache: "no-store" });

            if (!res.ok) return;

            const body = (await res.json()) as ServerStatus;

            this.setState({ serverStatus: body });

        } catch {

            // The poller will retry next tick.

        }

    }

    private togglePlayback = async (): Promise<void> => {

        try {

            if (this.state.playing) {

                await this.pipeline.suspend();
                this.setState({ playing: false });

            } else {

                await this.pipeline.start();

                this.setState({ playing: true, analyser: this.pipeline.getAnalyser() });

            }

        } catch (err) {

            this.setState({ errorMessage: toMessage(err) });

        }

    };

    private downloadClip = async (): Promise<void> => {

        this.setState({ clipBusy: true, errorMessage: null });

        try {

            const url = `/clip?guildID=${this.props.guildID}&seconds=${this.state.clipSeconds}`;

            const res = await fetch(url, { cache: "no-store" });

            if (!res.ok) {

                throw new Error(`clip failed: ${res.status} ${await res.text()}`);

            }

            const blob = await res.blob();
            const objectURL = URL.createObjectURL(blob);

            const link = document.createElement("a");

            link.href = objectURL;
            link.download = `echo-clip-${this.state.clipSeconds}s.wav`;

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            setTimeout(() => URL.revokeObjectURL(objectURL), 30_000);

        } catch (err) {

            this.setState({ errorMessage: toMessage(err) });

        } finally {

            this.setState({ clipBusy: false });

        }

    };

    private toggleRecording = async (): Promise<void> => {

        try {

            if (this.recorder.getStatus() === "recording") {

                await this.recorder.stop();

            } else {

                // Suspend listen before recording. Prevents the user hearing their own call twice (once in Discord, once through the browser).
                if (this.state.playing) {

                    await this.pipeline.suspend();
                    this.setState({ playing: false });

                }

                await this.recorder.start();

            }

            this.setState({ recorderStatus: this.recorder.getStatus() });

        } catch (err) {

            this.setState({ errorMessage: toMessage(err), recorderStatus: this.recorder.getStatus() });

        }

    };

    private joinChannel = async (channelID: string): Promise<void> => {

        try {

            const res = await fetch("/join", {

                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ guildID: this.props.guildID, channelID }),

            });

            if (!res.ok) {

                throw new Error(`join failed: ${res.status} ${await res.text()}`);

            }

            await this.refreshStatus();

        } catch (err) {

            this.setState({ errorMessage: toMessage(err) });

        }

    };

    private leaveChannel = async (): Promise<void> => {

        try {

            const res = await fetch("/leave", {

                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ guildID: this.props.guildID }),

            });

            if (!res.ok) {

                throw new Error(`leave failed: ${res.status} ${await res.text()}`);

            }

            await this.refreshStatus();

        } catch (err) {

            this.setState({ errorMessage: toMessage(err) });

        }

    };

    render() {

        return (

            <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-center gap-4 px-6 py-8 pb-10">

                <StatusBar socket={this.state.socketStatus} server={this.state.serverStatus} />

                <VUMeter analyser={this.state.analyser} />

                <Controls
                    guildID={this.props.guildID}
                    playing={this.state.playing}
                    onTogglePlayback={this.togglePlayback}
                    clipSeconds={this.state.clipSeconds}
                    onClipSecondsChange={(seconds) => this.setState({ clipSeconds: seconds })}
                    onDownloadClip={this.downloadClip}
                    clipBusy={this.state.clipBusy}
                    recorderStatus={this.state.recorderStatus}
                    onToggleRecording={this.toggleRecording}
                    onJoin={this.joinChannel}
                    onLeave={this.leaveChannel}
                    voiceConnected={!!this.state.serverStatus?.connected}
                />

                <VideoSync />

                {this.state.errorMessage && (

                    <div className="border border-border-strong bg-surface-raised px-4 py-3 text-sm text-danger rounded-none">

                        {this.state.errorMessage}

                    </div>

                )}

            </div>

        );

    }

}

function toMessage(err: unknown): string {

    if (err instanceof Error) return err.message;

    return String(err);

}
