import { Component } from "react";

import type { SocketStatus } from "../net/EchoSocket";

export interface ServerStatus {

    connected: boolean;
    guildID?: string;
    channelID?: string;
    listeners: number;
    speakers: number;
    bufferSeconds: number;
    sampleRate: number;
    channels: number;

}

interface Props {

    socket: SocketStatus;
    server: ServerStatus | null;

}

// StatusBar shows if the bot is alive, and how many listeners and speakers there are in the current channel (if connected).
export class StatusBar extends Component<Props> {

    render() {

        const { socket, server } = this.props;

        const live = socket === "open" && !!server?.connected;
        const connecting = socket === "connecting" || (socket === "open" && !server?.connected);

        return (

            <header className="flex w-full items-center gap-5 border border-border bg-surface px-5 py-3">

                <LivePill live={live} connecting={connecting} />

                {server?.connected && (

                    <>

                        <Divider />

                        <Stat value={String(server.speakers)} label={server.speakers === 1 ? "speaker" : "speakers"}/>

                        <Divider />

                        <Stat value={String(server.listeners)} label={server.listeners === 1 ? "listener" : "listeners"}/>

                    </>

                )}

            </header>

        );

    }

}

function LivePill({ live, connecting }: { live: boolean; connecting: boolean }) {

    const label = live ? "Live" : connecting ? "Connecting" : "Offline";

    return (

        <div className="flex items-center gap-2">

            <span  className={`h-2 w-2 shrink-0 rounded-none border border-border-strong ${ live ? "bg-live shadow-[0_0_0_1px_var(--color-border-strong)]" : connecting ? "animate-pulse bg-warn" : "bg-fg-subtle" }`}/>

            <span className={`text-[13px] font-medium tracking-wide ${ live ? "text-fg" : "text-fg-subtle" }`}>

                {label}

            </span>

        </div>

    );

}

function Divider() {

    return <span className="h-3.5 w-px shrink-0 bg-border-strong" />;

}

function Stat({ value, label }: { value: string; label: string }) {

    return (

        <div className="flex items-baseline gap-1.5">

            <span className="text-[13px] font-semibold text-fg">{value}</span>

            <span className="text-xs text-fg-muted">{label}</span>

        </div>

    );

}
