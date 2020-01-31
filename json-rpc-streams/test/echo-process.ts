import { NodeJsMessageStream } from "../src";

const stream = NodeJsMessageStream.connectToThisProcess();
stream.setReadCallback(msg => {
	stream.write({ method: "pong", params: { payload: msg as any } });
});
