import { WebSocketStream } from "@hediet/json-rpc-websocket";
import { ConsoleRpcLogger } from "@hediet/json-rpc";
import { observable, action, computed, when, autorun } from "mobx";
import {
	TypeSystem,
	Type,
	ObjectType,
	ObjectProperty,
} from "@hediet/semantic-json";
import { NodeContainer, createDefaultNode } from "@hediet/semantic-json-react";

export class Model {
	constructor() {
		this.stayConnected();
	}

	async stayConnected(): Promise<void> {
		/*
		while (true) {
			try {
				const stream = await WebSocketStream.connectTo({
					host: "localhost",
					port: this.port,
				});
				const { server } = uiContract.getServerFromStream(
					stream,
					new ConsoleRpcLogger(),
					{}
				);

				await stream.onClosed;
			} catch (e) {}

			//window.close();
		}*/
	}
}
