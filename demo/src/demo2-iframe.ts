import {
	connectToIFrame,
	connectIFrameToParent,
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

if (window.self === window.top) {
	// parent
	document.body.innerHTML = `
		<h1>IFrame Demo (Parent Window)</h1>
		<iframe id="iframe1" src="${document.URL}"></iframe>
		<div id="myDiv" />
	`;
	const myDiv = document.getElementById("myDiv")!;

	function writeln(str: string) {
		myDiv.innerHTML += str + "<br />";
	}

	const { server } = Contract.getServerFromStream(
		api,
		connectToIFrame(
			document.getElementById("iframe1") as HTMLIFrameElement
		),
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
	// IFrame
	document.body.innerHTML = `(IFrame Window)`;

	Contract.registerServerToStream(
		api,
		connectIFrameToParent(),
		{ logger: new ConsoleRpcLogger(), sendExceptionDetails: true },
		{
			calculate: async ({ name }, { counterpart }) => {
				for (let i = 0; i <= 10; i++) {
					for (let j = 0; j < 100000000; j++) {}
					if (i === 5 && name === "bar") {
						throw new Error("Example Error.");
					}
					counterpart.progress({ progress: i / 10 });
				}
				return "bla" + name;
			},
		}
	);
}
