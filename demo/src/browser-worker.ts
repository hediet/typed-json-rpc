import {
	connectToWorker,
	workerConnectToParent,
} from "@hediet/json-rpc-browser";
import {
	contract,
	ConsoleRpcLogger,
	semanticJson,
	requestType,
	notificationType,
	Contract,
} from "@hediet/json-rpc";

const api = contract({
	name: "API",
	server: {
		calculate: requestType({
			params: semanticJson.sObject({
				name: semanticJson.sString(),
			}),
			result: semanticJson.sString(),
		}),
	},
	client: {
		progress: notificationType({
			params: semanticJson.sObject({
				progress: semanticJson.sNumber(),
			}),
		}),
	},
});

if (typeof window !== "undefined") {
	// window:
	const worker = new Worker("./browser-worker.ts");
	const { server } = Contract.getServerFromStream(
		api,
		connectToWorker(worker),
		new ConsoleRpcLogger(),
		{
			progress: ({ progress }) => {
				console.log(progress);
			},
		}
	);

	server.calculate({ name: "foo" }).catch(console.error);
} else {
	// worker:
	const { client, channel } = Contract.registerServerToStream(
		api,
		workerConnectToParent(),
		new ConsoleRpcLogger(),
		{
			calculate: async ({ name }, { counterpart }) => {
				for (let i = 0; i <= 10; i++) {
					for (let j = 0; j < 100000000; j++) {}
					client.progress({ progress: i / 10 });
				}
				throw "test";
				return "bla" + name;
			},
		}
	);
}
