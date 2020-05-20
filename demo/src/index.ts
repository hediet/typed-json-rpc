import {
	contract,
	semanticJson as s,
	ConsoleRpcLogger,
	ConsoleStreamLogger,
	registerReflector,
	reflectContract,
	TypedChannel,
	Contract,
	requestType,
	notificationType,
	ErrorCode,
} from "@hediet/json-rpc";
import { WebSocketStream } from "@hediet/json-rpc-websocket";
import { startWebSocketServer } from "@hediet/json-rpc-websocket-server";

const chatContract = contract({
	name: "ChatContract",
	server: {
		sendMessage: requestType({
			params: s.sTuple().addItem("msg", s.sString),
			/*params: s.sArray(s.sString).refine<{ msg: string }>({
				canSerialize: (obj): obj is { msg: string } => true,
				deserialize: o => s.deserializationValue({ msg: o[0] }),
				serialize: o => [o.msg],
			}),*/
		}),
		ping: requestType({}),
	},
	client: {
		onNewMessage: notificationType({
			params: s.sObject({ msg: s.sString }),
		}),
	},
});

const clients = new Set<typeof chatContract.TClientInterface>();
const logger = new ConsoleRpcLogger();

const srvr = startWebSocketServer(
	{ listenOn: { port: "random" } },
	async stream => {
		const { client, channel } = Contract.registerServerToStream(
			chatContract,
			stream,
			logger,
			{
				sendMessage: async args => {
					console.log(args.msg);
					for (const c of clients) {
						c.onNewMessage({ msg: args.msg });
					}
				},
				ping: async ({}) => {},
			}
		);

		registerReflector(channel);
		clients.add(client);
		await stream.onClosed;
		clients.delete(client);
	}
);

async function main() {
	const { server, channel } = Contract.getServerFromStream(
		chatContract,
		new ConsoleStreamLogger(
			await WebSocketStream.connectTo({
				host: "localhost",
				port: srvr.port,
			})
		),
		logger,
		{
			onNewMessage: (args, {}) => console.log("onNewMessage: ", args.msg),
		}
	);

	const { server: rs } = reflectContract.getServer(channel, {});

	const data = await rs.list();
	console.log(data);

	server.sendMessage({ msg: "Hello world" });
	server.ping();
}

setInterval(() => {
	console.log("step");
}, 1000);

main().catch(e => console.error(e));
