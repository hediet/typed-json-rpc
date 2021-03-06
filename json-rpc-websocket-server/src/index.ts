import WebSocket = require("ws");
import { WebSocketStream } from "@hediet/json-rpc-websocket";
import { EventEmitter, EventSource } from "@hediet/std/events";
import { Barrier } from "@hediet/std/synchronization";
import * as http from "http";
import * as https from "https";

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
	handleConnection: (stream: WebSocketStream) => void
): WebSocketServer {
	let opts: WebSocket.ServerOptions = {};
	const l = options.listenOn;
	if ("port" in l) {
		opts.port = l.port === "random" ? 0 : l.port;
	} else if ("server" in l) {
		opts.server = l.server;
	}

	const wss = new WebSocket.Server(opts);
	wss.on("connection", ws => {
		const stream = new WebSocketStream(ws);
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

		const errorEventEmitter = new EventEmitter<Error, WebSocketServer>();
		this.onError = errorEventEmitter.asEvent();
		server.on("error", error => {
			if (state == "None") {
				state = "Error";
				listeningEventEmitter.reject(error);
			}
			errorEventEmitter.emit(error, this);
		});
	}

	/**
	 * Is resolved once the socket is listening.
	 */
	public readonly onListening: Promise<void>;
	public readonly onError: EventSource<Error, WebSocketServer>;

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
