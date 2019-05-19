import { BaseMessageStream, Message } from "@hediet/typed-json-rpc";

interface WindowLike {
	postMessage(data: any, ...misc: any[]): void;
	addEventListener(ev: "message", handler: (ev: { data: any }) => void): void;
}

class WindowLikeStream extends BaseMessageStream {
	constructor(private readonly windowLike: WindowLike) {
		super();

		windowLike.addEventListener("message", ({ data }) => {
			this.onMessage(data);
		});
	}

	public async write(message: Message): Promise<void> {
		this.windowLike.postMessage(message);
	}

	public toString(): string {
		return `${this.id}@${this.windowLike}`;
	}
}

export function workerConnectToParent(): BaseMessageStream {
	if (typeof self === "undefined" || typeof importScripts === "undefined") {
		throw new Error(`Call this function from a worker script`);
	}

	return new WindowLikeStream(self);
}

export function connectToWorker(worker: Worker): BaseMessageStream {
	if (typeof window === "undefined") {
		throw new Error(`call this function from the main browser thread`);
	}
	return new WindowLikeStream(worker);
}
