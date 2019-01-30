import { Message, BaseMessageStream, StreamBasedChannel, TypedChannel } from "@hediet/typed-json-rpc";
import WebSocket = require("isomorphic-ws");
import { RpcLogger } from "@hediet/typed-json-rpc/build/Logger";

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
            ws.on("error", () => {
                rej();
            })
            ws.on("open", () => {
                res(new WebSocketStream(ws));
            });
        });
    }

    constructor(private readonly ws: WebSocket) {
        super();

        ws.on("message", (data) => {
            if (typeof data === "string") {
                const json = JSON.parse(data);
                // TODO check type of json
                this.onMessage(json);
            } else {
                throw new Error("Not supported"); // TODO fix
            }
        });

        ws.on("close", _event => {
            this.onConnectionClosed();
        });
    }

    public write(message: Message): Promise<void> {
        const str = JSON.stringify(message);
        this.ws.send(str);
        return Promise.resolve();
    }

    public toString(): string {
        return "isomorphic-ws";
    }
}

export namespace TypedWebSocketClientChannel {
    export async function connectTo(options: WebSocketOptions, logger: RpcLogger|undefined): Promise<TypedChannel> {
        const stream = await WebSocketStream.connectTo(options);
        const channelFactory = StreamBasedChannel.getFactory(stream, logger);
        return new TypedChannel(channelFactory, logger);
    }
}
