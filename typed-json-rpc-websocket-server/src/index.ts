import WebSocket = require("ws");
import {
	TypedChannel,
	StreamBasedChannel,
	RpcLogger,
} from "@hediet/typed-json-rpc";
import { WebSocketStream } from "@hediet/typed-json-rpc-websocket";

export function startWebSocketServer(
	options: { port?: number },
	logger: RpcLogger | undefined,
	handleConnection: (channel: TypedChannel, stream: WebSocketStream) => void
): WebSocketServer {
	let opts: WebSocket.ServerOptions = {};
	if (options.port) {
		opts.port = options.port;
	}

	const wss = new WebSocket.Server(opts);
	wss.on("connection", ws => {
		const stream = new WebSocketStream(ws);
		const channelFactory = StreamBasedChannel.getFactory(stream, logger);
		handleConnection(new TypedChannel(channelFactory, logger), stream);
	});

	return new WebSocketServer(wss);
}

export class WebSocketServer {
	constructor(private readonly server: WebSocket.Server) {}

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
