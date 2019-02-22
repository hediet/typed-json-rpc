import { Message, BaseMessageStream } from "@hediet/typed-json-rpc";
import WebSocket = require("isomorphic-ws");

export type NormalizedWebSocketOptions = {
    address: string;
}

export type WebSocketOptions = NormalizedWebSocketOptions | {
    host: string;
    port: number;
    forceTls?: boolean;
};

export function normalizeWebSocketOptions(options: WebSocketOptions): NormalizedWebSocketOptions {
    if ("host" in options) {
        const useTls = options.forceTls!!;
        return {
            address: `${useTls ? "wss" : "ws"}://${options.host}:${options.port}`
        };
    } else {
        return options;
    }
}

export class WebSocketStream extends BaseMessageStream {
    public static connectTo(options: WebSocketOptions): Promise<WebSocketStream> {
        const normalizedOptions = normalizeWebSocketOptions(options);
        const ws = new WebSocket(normalizedOptions.address);
        return new Promise((res, rej) => {
            ws.onerror = (err) => {
                rej(err);
            };
            ws.onopen = () => {
                res(new WebSocketStream(ws));
            };
        });
    }

    constructor(private readonly ws: WebSocket) {
        super();

        ws.onmessage = msg => {
            const data = msg.data;
            if (typeof data === "string") {
                const json = JSON.parse(data);
                // TODO check type of json
                this.onMessage(json);
            } else {
                throw new Error("Not supported"); // TODO fix
            }
        };

        ws.onclose = _event => {
            this.onConnectionClosed();
        };
    }

    public write(message: Message): Promise<void> {
        const str = JSON.stringify(message);
        this.ws.send(str);
        return Promise.resolve();
    }

    public toString(): string {
        return "ws";
    }
}
