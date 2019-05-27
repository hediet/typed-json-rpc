import {
	contract,
	types as t,
	requestContract,
	notificationContract,
	ConsoleRpcLogger,
	ConsoleStreamLogger,
} from "@hediet/typed-json-rpc";
import { WebSocketStream } from "@hediet/typed-json-rpc-websocket";
import { startWebSocketServer } from "@hediet/typed-json-rpc-websocket-server";

const c = contract({
	server: {
		sendMessage: requestContract({ params: t.type({ msg: t.string }) }),
		ping: requestContract({}),
	},
	client: {
		onNewMessage: notificationContract({
			params: t.type({ msg: t.string }),
		}),
	},
});

const clients = new Set<typeof c.TClientInterface>();
const logger = new ConsoleRpcLogger();

startWebSocketServer({ port: 12345 }, async stream => {
	const { client } = c.registerServerToStream(stream, logger, {
		sendMessage: async (args, {}) => {
			console.log(args.msg);
			for (const c of clients) {
				c.onNewMessage({ msg: args.msg });
			}
		},
		ping: async () => {},
	});
	clients.add(client);
	await stream.onClosed;
	clients.delete(client);
});

async function main() {
	const { server } = c.getServerFromStream(
		new ConsoleStreamLogger(
			await WebSocketStream.connectTo({ address: "ws://localhost:12345" })
		),
		logger,
		{
			onNewMessage: (args, {}) => console.log("onNewMessage: ", args.msg),
		}
	);
	server.sendMessage({ msg: "hello world" });
	server.ping();
}

main();
