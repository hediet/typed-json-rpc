import { NodeJsMessageStream } from "../src";
import { spawn } from "child_process";
import { join } from "path";
import { Message } from "@hediet/json-rpc";
import { deepEqual } from "assert";
import { wait } from "@hediet/std/timer";

describe("NodeJsMessageStream", () => {
	it("should be able to write and read", async () => {
		const proc = spawn("node", [join(__dirname, "echo-process")]);
		const stream = NodeJsMessageStream.connectToProcess(proc);
		const messages = new Array<Message>();
		stream.setReadCallback(msg => {
			messages.push(msg);
		});
		const msg = {
			jsonrpc: "2.0" as const,
			method: "ping",
			params: { foo: 1 },
		};
		await stream.write(msg);
		await wait(200);
		proc.kill();

		deepEqual(messages, [
			{ jsonrpc: "2.0", method: "pong", params: { payload: msg } },
		]);
	});
});
