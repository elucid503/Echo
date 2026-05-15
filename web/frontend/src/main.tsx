import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";

import { Dashboard } from "./Dashboard";

const rootElement = document.getElementById("root");

if (!rootElement) {

    throw new Error("Echo: #root element missing from index.html");

}

const guildID = new URLSearchParams(window.location.search).get("guildID") ?? "";

createRoot(rootElement).render(

    <StrictMode>

        {guildID ? (

            <Dashboard guildID={guildID} />

        ) : (

            <Splash />

        )}

    </StrictMode>,

);

function Splash() {

    return (

        <div className="flex min-h-full flex-col items-center justify-center gap-4 p-8 text-center">

            <h1 className="m-0 text-[22px] font-semibold text-fg">

                Echo

            </h1>

            <p className="m-0 max-w-xs text-sm text-fg-muted">

                Use{" "}

                <code className="rounded-none border border-border bg-surface-inset px-1.5 py-0.5 font-mono text-xs text-fg">

                    /connect

                </code>{" "}

                in your Discord server. The bot will reply with a link to your server's dashboard.

            </p>

        </div>

    );

}
