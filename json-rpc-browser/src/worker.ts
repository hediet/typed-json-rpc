import { BaseMessageStream } from "@hediet/json-rpc";
import { WindowLikeStream } from "./WindowLikeStream";

/**
 * Gets a stream that uses `self.postMessage` to write
 * and `self.addEventListener` to read messages.
 */
export function connectWorkerToParent(): BaseMessageStream {
	if (typeof self === "undefined" || typeof importScripts === "undefined") {
		throw new Error(`Call this function from a worker script`);
	}

	return new WindowLikeStream(self);
}

/**
 * Gets a stream that uses `worker.postMessage` to write
 * and `worker.addEventListener` to read messages.
 */
export function connectToWorker(worker: Worker): BaseMessageStream {
	if (typeof window === "undefined") {
		throw new Error(`call this function from the main browser thread`);
	}
	return new WindowLikeStream(worker);
}
