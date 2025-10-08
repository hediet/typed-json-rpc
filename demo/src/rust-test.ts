/*
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

*/

import { requestType } from "@hediet/json-rpc";
import { ISerializer, SerializerOf } from "@hediet/json-rpc/src/schema";
import { z } from "zod";

declare global {
	export interface JsonRpcSerializerMapper<T> {
		zod2(val: T): T extends (z.ZodType<infer TResult>) ? ISerializer<TResult> : undefined;
	}
}


const schema = z.object({ foo: z.string() });

type T = typeof schema;
type T2 = SerializerOf<T>;
type T3 = SerializerOf<ISerializer<string>>;

const x = requestType({ params: schema, result: schema });
x




/*interface SerializerMapper {
	(value: string): IContainer<string>;
}*/

/*interface SerializerMapper {
	<U>(value: z.ZodType<U>): IContainer<U>;
}


interface IContainer<T> {
	value: T;
}

type SerializerOf<T> = SerializerMapper extends (arg: T) => infer R ? R : never;


function toSerializer<T>(s: T): SerializerOf<T> {
	throw new Error("Not implemented");
}

const s1 = toSerializer(z.object({ foo: z.string() }));
s1.value; // this is unknown



s1.deserializeFromJson(null!).value?.foo;

const c = contract({
	name: "c",
	server: {
		query_packages: requestType({
			params: z.object({ foo: z.string() }),
			result: z.array(z.string()),
		}),
	},
	client: {},
});
c.getServer(null!).server.query_packages({})*/