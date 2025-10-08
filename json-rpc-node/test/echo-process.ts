import { NodeJsMessageTransport } from "../src";

const stream = NodeJsMessageTransport.connectToThisProcess();
stream.setListener(msg => {
	stream.send({
		jsonrpc: "2.0",
		method: "pong",
		params: { payload: msg as any },
	});
});
