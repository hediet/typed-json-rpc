import {
	semanticJson as s,
	contract,
	requestType,
	ConsoleRpcLogger,
	Contract,
} from "@hediet/json-rpc";
import { NodeJsMessageStream } from "@hediet/json-rpc-streams";
import { spawn, exec } from "child_process";

const c = contract({
	name: "c",
	server: {
		query_packages: requestType({
			params: s.sArrayOf(s.sString()),
			result: s.sArrayOf(s.sString()),
		}),
	},
	client: {},
});

async function main() {
	const path =
		"S:\\dev\\2019\\vscode\\vscode-npm-support\\rust-test\\target\\debug\\rust-test.exe";
	const p = spawn(path, {
		cwd: "S:\\dev\\2019\\vscode\\vscode-npm-support\\rust-test\\",
	});

	p.on("error", (e) => console.error(e));
	p.on("message", (m) => console.log(m));
	p.stdout!.on("data", (d) => console.log(d));
	p.stderr!.on("data", (d) => console.log(d.toString()));

	const { server } = Contract.getServerFromStream(
		c,
		NodeJsMessageStream.connectToProcess(p),
		new ConsoleRpcLogger(),
		{}
	);

	console.log(await server.query_packages(["hediet"]));
	console.log(await server.query_packages(["json"]));
}

main();
