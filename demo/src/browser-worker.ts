import {
	connectToWorker,
	workerConnectToParent,
} from "@hediet/typed-json-rpc-browser";
import {
	contract,
	requestContract,
	notificationContract,
} from "@hediet/typed-json-rpc";
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

// main:
const worker = new Worker("./worker.ts");
const { server } = api.getServerFromStream(connectToWorker(worker), undefined, {
	progress: ({ progress }) => {
		console.log(progress);
	},
});

server.calculate({ name: "foo" });

// worker:
api.registerServerToStream(workerConnectToParent(), undefined, {
	calculate: async ({ name }, { counterpart }) => {
		counterpart.progress({ progress: 100 });
		return "bla" + name;
	},
});
