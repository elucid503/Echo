import { Component } from "react";

import { isFileSystemAccessSupported, type RecorderStatus } from "../record/Recorder";

// Props and state types for the Controls component

interface Props {

	guildID: string;

	playing: boolean;
	onTogglePlayback: () => void;

	clipSeconds: number;
	onClipSecondsChange: (value: number) => void;

	onDownloadClip: () => void;
	clipBusy: boolean;

	recorderStatus: RecorderStatus;
	onToggleRecording: () => void;

	onJoin: (channelID: string) => void;
	onLeave: () => void;
	voiceConnected: boolean;

}

interface State {

	channelID: string;

}

// Some tailwind-specific stuff

const panelClass = "flex min-h-0 h-full flex-col gap-4 border border-border bg-surface p-5";
const panelTitleClass ="mb-0 text-[11px] font-semibold uppercase tracking-[0.07em] text-fg-subtle";
const primaryBtnClass = "rounded-none w-full cursor-pointer border-0 bg-accent px-5 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed";
const dangerBtnClass = "rounded-none w-full cursor-pointer border border-border-strong bg-fg px-5 py-2.5 text-sm font-semibold text-bg transition-opacity hover:opacity-90";
const secondaryBtnClass = "rounded-none w-full cursor-pointer border border-border-strong bg-surface-raised px-5 py-2.5 text-sm font-semibold text-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed";
const ghostBtnClass = "rounded-none w-full cursor-pointer border border-border-strong bg-transparent px-5 py-2.5 text-sm font-medium text-fg-muted transition-opacity hover:opacity-80";
const inputClass = "rounded-none w-full border border-border-strong bg-surface-inset px-3 py-2 text-[13px] text-fg outline-none placeholder:text-fg-subtle focus:border-border-strong";

export class Controls extends Component<Props, State> {

	state: State = { channelID: "" };

	private recorderSupported = isFileSystemAccessSupported();

	render() {

		const { playing, clipBusy, recorderStatus, voiceConnected } = this.props;

		return (

			<div className="grid grid-cols-1 gap-3 sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-2">

				<div className={panelClass}>

					<p className={panelTitleClass}>Playback</p>

					<button type="button" onClick={this.props.onTogglePlayback} className={`mt-auto ${playing ? dangerBtnClass : primaryBtnClass}`}>

						{playing ? "Pause" : "Listen"}

					</button>

				</div>

				<div className={panelClass}>

					<p className={panelTitleClass}>Clip</p>

					<button type="button" onClick={this.props.onDownloadClip} disabled={clipBusy} className={`mt-auto ${primaryBtnClass} ${ clipBusy ? "bg-surface-raised text-fg-subtle opacity-80 hover:opacity-80" : "" }`}>

						{clipBusy ? "Building…" : "Download WAV"}

					</button>

				</div>

				<div className={panelClass}>

					<p className={panelTitleClass}>Session recording</p>

					{this.recorderSupported ? (

						<button type="button" onClick={this.props.onToggleRecording} disabled={recorderStatus === "finalising"} className={`mt-auto ${ recorderStatus === "recording" ? dangerBtnClass : `${secondaryBtnClass} disabled:opacity-50` }`}>

							{labelForRecorder(recorderStatus)}

						</button>

					) : (

						<p className="m-0 text-xs text-fg-muted">

							Use Chrome or Edge to record sessions.

						</p>

					)}

				</div>

				<div className={panelClass}>

					<p className={panelTitleClass}>Voice channel</p>

					{voiceConnected ? (

						<button type="button" onClick={this.props.onLeave} className={`mt-auto ${ghostBtnClass}`}>

							Disconnect

						</button>

					) : (

						<div className="mt-auto flex w-full flex-col gap-2">

							<input type="text" inputMode="numeric" value={this.state.channelID} onChange={(e) => this.setState({ channelID: e.target.value })} placeholder="Channel ID" className={inputClass}/>

							<button type="button" onClick={() => this.props.onJoin(this.state.channelID.trim())} className={`${primaryBtnClass} disabled:opacity-50`} disabled={!this.state.channelID.trim()}>

								Join

							</button>

						</div>

					)}

				</div>

			</div>

		);

	}

}

function labelForRecorder(status: RecorderStatus): string {

	switch (status) {

		case "recording": return "Stop Recording";
		case "finalising": return "Finalising...";
		case "error": return "Error! Please try again";
		default: return "Start Recording";

	}

}
