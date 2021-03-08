import { ConsoleRpcLogger, Contract } from "@hediet/json-rpc";
import { connectWorkerToParent } from "@hediet/json-rpc-browser";
import { api } from "./contracts";

const { client, channel } = Contract.registerServerToStream(
	api,
	connectWorkerToParent(),
	{
		logger: new ConsoleRpcLogger(),
		sendExceptionDetails: true,
	},
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
