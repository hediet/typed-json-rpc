import WebSocket = require("ws");
import { WebSocketStream } from "@hediet/typed-json-rpc-websocket";
import { EventEmitter, EventSource } from "@hediet/std/events";
import { Barrier } from "@hediet/std/synchronization";

export function startWebSocketServer(
	options: { port?: number },
	handleConnection: (stream: WebSocketStream) => void
): WebSocketServer {
	let opts: WebSocket.ServerOptions = {};
	if (options.port !== undefined) {
		opts.port = options.port;
	}

	const wss = new WebSocket.Server(opts);
	wss.on("connection", ws => {
		const stream = new WebSocketStream(ws);
		handleConnection(stream);
	});

	return new WebSocketServer(wss);
}

export class WebSocketServer {
	constructor(private readonly server: WebSocket.Server) {
		const listeningEventEmitter = new Barrier<void>();
		this.onListening = listeningEventEmitter.onUnlocked;
		let state: "None" | "Listening" | "Error" = "None";
		server.on("listening", () => {
			listeningEventEmitter.unlock();
			state = "Listening";
		});

		const errorEventEmitter = new EventEmitter<Error>();
		this.onError = errorEventEmitter.asEvent();
		server.on("error", error => {
			if (state == "None") {
				state = "Error";
				listeningEventEmitter.reject(error);
			}
			errorEventEmitter.emit(error, this);
		});
	}

	public readonly onListening: Promise<void>;
	public readonly onError: EventSource<Error>;

	public get port(): number {
		const addrInfo = this.server.address() as WebSocket.AddressInfo;
		return addrInfo.port;
	}

	public close(): void {
		this.server.close();
	}

	public dispose(): void {
		this.close();
	}
}
