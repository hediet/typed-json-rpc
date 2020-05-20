import { NodeJsMessageStream } from "../src";

const stream = NodeJsMessageStream.connectToThisProcess();
stream.setReadCallback(msg => {
	stream.write({
		jsonrpc: "2.0",
		method: "pong",
		params: { payload: msg as any },
	});
});
