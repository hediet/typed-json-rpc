import WebSocket = require("ws");
import { TypedChannel, StreamBasedChannel } from "@hediet/typed-json-rpc";
import { WebSocketStream } from "@hediet/typed-json-rpc-websocket";
import { RpcLogger } from "@hediet/typed-json-rpc/build/Logger";

export function startServer(options: { port?: number }, logger: RpcLogger|undefined, handleConnection: (channel: TypedChannel) => void) {
    let opts: WebSocket.ServerOptions = {};
    if (options.port) {
        opts.port = options.port;
    }

    const wss = new WebSocket.Server(opts);
    wss.on("connection", ws => {
        const stream = new WebSocketStream(ws);
        const channelFactory = StreamBasedChannel.getFactory(stream, logger);
        handleConnection(new TypedChannel(channelFactory, logger));
    });
}
