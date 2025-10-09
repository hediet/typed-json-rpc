import { BaseMessageTransport } from "@hediet/json-rpc";
import { WindowLikeTransport } from "./WindowLikeStream";

/**
 * Gets a stream that uses `self.postMessage` to write
 * and `self.addEventListener` to read messages.
 */
export function createTransportFromWorkerToParent(): BaseMessageTransport {
	if (typeof self === "undefined" || typeof importScripts === "undefined") {
		throw new Error(`Call this function from a worker script`);
	}

	return new WindowLikeTransport(self);
}

/**
 * Gets a stream that uses `worker.postMessage` to write
 * and `worker.addEventListener` to read messages.
 */
export function createTransportToWorker(worker: Worker): BaseMessageTransport {
	if (typeof window === "undefined") {
		throw new Error(`call this function from the main browser thread`);
	}
	return new WindowLikeTransport(worker);
}
