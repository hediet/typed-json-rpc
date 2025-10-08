import {
	connectToWorker,
	connectWorkerToParent,
} from "@hediet/json-rpc-browser";
import {
	contract,
	ConsoleRpcLogger,
	Contract,
	unverifiedRequest,
	unverifiedNotification,
} from "@hediet/json-rpc";

const api = contract({
	name: "API",
	server: {
		calculate: unverifiedRequest<{ name: string }, string>(),
	},
	client: {
		progress: unverifiedNotification<{ progress: number }>(),
	},
});

if (typeof window !== "undefined") {
	function writeln(str: string) {
		document.writeln(str + "<br />");
	}

	// window:
	const worker = new Worker(new URL("./demo1-webworker.ts", import.meta.url));

	const { server } = Contract.getServerFromStream(
		api,
		connectToWorker(worker),
		{ logger: new ConsoleRpcLogger() },
		{
			progress: ({ progress }) => {
				writeln(`${progress}`);
			},
		}
	);

	(async () => {
		try {
			const result1 = await server.calculate({ name: "foo" });
			writeln(`result1: ${result1}`);
			const result2 = await server.calculate({ name: "bar" });
			writeln(`result2: ${result2}`);
		} catch (e) {
			writeln(`${e}`);
		}
	})();
} else {
	// worker:
	Contract.registerServerToStream(
		api,
		connectWorkerToParent(),
		{ logger: new ConsoleRpcLogger(), sendExceptionDetails: true },
		{
			calculate: async ({ name }, { counterpart }) => {
				for (let i = 0; i <= 10; i++) {
					for (let j = 0; j < 100000000; j++) { }
					if (i === 5 && name === "bar") {
						throw "`bar` is not supported.";
					}
					counterpart.progress({ progress: i / 10 });
				}
				return "bla" + name;
			},
		}
	);
}
