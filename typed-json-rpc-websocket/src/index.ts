import { Message, BaseMessageStream } from "@hediet/typed-json-rpc";
import WebSocket = require("isomorphic-ws");

export type NormalizedWebSocketOptions = {
	address: string;
};

export type WebSocketOptions =
	| NormalizedWebSocketOptions
	| {
			host: string;
			port: number;
			forceTls?: boolean;
	  };

/**
 * Normalizes the given options to `NormalizedWebSocketOptions`.
 * It builds the address from a given host and port.
 */
export function normalizeWebSocketOptions(
	options: WebSocketOptions
): NormalizedWebSocketOptions {
	if ("host" in options) {
		const useTls = options.forceTls!!;
		return {
			address: `${useTls ? "wss" : "ws"}://${options.host}:${
				options.port
			}`,
		};
	} else {
		return options;
	}
}

/**
 * Represents a stream through a web socket.
 * Use the static `connectTo` method to get a stream to a web socket server.
 */
export class WebSocketStream extends BaseMessageStream {
	public static connectTo(
		options: WebSocketOptions
	): Promise<WebSocketStream> {
		const normalizedOptions = normalizeWebSocketOptions(options);
		const ws = new WebSocket(normalizedOptions.address);
		return new Promise((res, rej) => {
			// don't use `on` as it does not exist for browsers
			ws.onerror = err => {
				rej(err);
			};
			ws.onopen = () => {
				res(new WebSocketStream(ws));
			};
		});
	}

	constructor(private readonly socket: WebSocket) {
		super();

		socket.onmessage = msg => {
			const data = msg.data;
			if (typeof data === "string") {
				const json = JSON.parse(data);
				// TODO check type of json
				this.onMessage(json);
			} else {
				throw new Error("Not supported"); // TODO test
			}
		};

		socket.onclose = _event => {
			this.onConnectionClosed();
		};
	}

	/**
	 * Closes the underlying socket.
	 */
	public close(): void {
		this.socket.close();
	}

	/**
	 * Same as `close`.
	 */
	public dispose(): void {
		this.close();
	}

	public write(message: Message): Promise<void> {
		const str = JSON.stringify(message);

		return new Promise((res, rej) => {
			this.socket.send(str, err => {
				if (err) {
					rej(err);
				} else {
					res();
				}
			});
		});
	}

	public toString(): string {
		return `${this.id}@${this.socket.url}`;
	}
}
