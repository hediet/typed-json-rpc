import { NodeJsMessageTransport } from "../src";
import { spawn } from "child_process";
import { join } from "path";
import { Message } from "@hediet/json-rpc";
import { deepStrictEqual } from "assert";

describe("NodeJsMessageStream", () => {
	it("should be able to write and read", async () => {
		const proc = spawn("node", [join(__dirname, "echo-process")]);
		const stream = NodeJsMessageTransport.connectToProcess(proc);
		const messages = new Array<Message>();
		stream.setListener(msg => {
			messages.push(msg);
		});
		const msg = {
			jsonrpc: "2.0" as const,
			method: "ping",
			params: { foo: 1 },
		};
		await stream.send(msg);
		await new Promise<void>(resolve => setTimeout(resolve, 100));
		proc.kill();

		deepStrictEqual(messages, [
			{ jsonrpc: "2.0", method: "pong", params: { payload: msg } },
		]);
	});
});
