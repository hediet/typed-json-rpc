import {
	connectToWorker,
	workerConnectToParent,
} from "@hediet/json-rpc-browser";
import {
	contract,
	requestContract,
	notificationContract,
	ConsoleRpcLogger,
} from "@hediet/json-rpc";
import { string, type, number } from "io-ts";

const api = contract({
	server: {
		calculate: requestContract({
			params: type({
				name: string,
			}),
			result: string,
		}),
	},
	client: {
		progress: notificationContract({
			params: type({
				progress: number,
			}),
		}),
	},
});

if (typeof window !== "undefined") {
	// window:
	const worker = new Worker("./browser-worker.ts");
	const { server } = api.getServerFromStream(
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
	const { client, channel } = api.registerServerToStream(
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
