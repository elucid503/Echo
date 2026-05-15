export type SocketStatus = "disconnected" | "connecting" | "open" | "closed";

interface SocketCallbacks {

	onFrame: (frame: ArrayBuffer) => void;
	onStatus: (status: SocketStatus) => void;

}

interface SocketOptions extends SocketCallbacks {

	guildID: string;

}

const RECONNECT_DELAY_MS = 1500;

export class EchoSocket {

	private ws: WebSocket | null = null;
	private reconnectTimer: number | null = null;
	private shouldReconnect = true;

	private readonly guildID: string;
	private readonly callbacks: SocketCallbacks;

	constructor(options: SocketOptions) {

		this.guildID = options.guildID;
		this.callbacks = { onFrame: options.onFrame, onStatus: options.onStatus };

	}

	connect(): void {

		this.shouldReconnect = true;

		this.open();

	}

	disconnect(): void {

		this.shouldReconnect = false;

		if (this.reconnectTimer !== null) {

			window.clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;

		}

		if (this.ws) {

			this.ws.close();

		}

	}

	private open(): void {

		const scheme = window.location.protocol === "https:" ? "wss" : "ws";
		const url = `${scheme}://${window.location.host}/ws?guildID=${this.guildID}`;

		this.callbacks.onStatus("connecting");

		const ws = new WebSocket(url);
		ws.binaryType = "arraybuffer";

		ws.onopen = () => this.callbacks.onStatus("open");

		ws.onmessage = (event) => {

			if (event.data instanceof ArrayBuffer) {

				this.callbacks.onFrame(event.data);

			}

		};

		ws.onclose = () => {

			this.callbacks.onStatus("closed");

			if (this.shouldReconnect) {

				this.reconnectTimer = window.setTimeout(() => this.open(), RECONNECT_DELAY_MS);

			}

		};

		ws.onerror = () => {

			// Errors surface via onclose; the browser exposes nothing actionable here.

		};

		this.ws = ws;

	}

}
