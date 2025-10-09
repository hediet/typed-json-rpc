import * as WebSocket from "ws";
import { WebSocketTransport } from "./index";
import * as http from "http";
import * as https from "https";
import { EventEmitter, IEvent, Barrier } from "@hediet/json-rpc";

export interface StartWebSocketServerOptions {
	/**
	 * Where to listen on.
	 * Use `port` to listen on a specific or random port.
	 * Use `server` to listen on an existing server.
	 */
	listenOn:
	| { port: number | "random" }
	| { server: http.Server | https.Server };
}

/**
 * Starts a new web socket server.
 * Use `handleConnection` to handle the streams of incoming connections.
 */
export function startWebSocketServer(
	options: StartWebSocketServerOptions,
	handleConnection: (stream: WebSocketTransport) => void
): WebSocketServer {
	const opts: WebSocket.ServerOptions = {};
	const l = options.listenOn;
	if ("port" in l) {
		opts.port = l.port === "random" ? 0 : l.port;
	} else if ("server" in l) {
		opts.server = l.server;
	}

	const wss = new WebSocket.Server(opts);
	wss.on("connection", ws => {
		const stream = WebSocketTransport.fromWebSocket(ws);
		handleConnection(stream);
	});

	return new WebSocketServer(wss);
}

/**
 * Wraps a websocket server.
 */
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
		this.onError = errorEventEmitter.event;
		server.on("error", error => {
			if (state == "None") {
				state = "Error";
				listeningEventEmitter.reject(error);
			}
			errorEventEmitter.fire(error);
		});
	}

	/**
	 * Is resolved once the socket is listening.
	 */
	public readonly onListening: Promise<void>;
	public readonly onError: IEvent<Error>;

	/**
	 * Gets the port the websocket server is running on.
	 */
	public get port(): number {
		const addrInfo = this.server.address() as WebSocket.AddressInfo;
		return addrInfo.port;
	}

	/**
	 * Closes the server.
	 */
	public close(): void {
		this.server.close();
	}

	/**
	 * Same as `close`.
	 */
	public dispose(): void {
		this.close();
	}
}
