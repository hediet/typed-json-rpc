import { BaseMessageTransport } from "@hediet/json-rpc";
import { WindowLikeTransport } from "./WindowLikeStream";

/**
 * Gets a stream that uses `self.postMessage` to write
 * and `self.addEventListener` to read messages.
 */
export function createTransportFromIFrameToParent(): BaseMessageTransport {
	if (window.self === window.top) {
		throw new Error(`Call this function from an iframe!`);
	}

	return new WindowLikeTransport(self, parent.window);
}

/**
 * Gets a stream that uses `worker.postMessage` to write
 * and `worker.addEventListener` to read messages.
 */
export function createTransportToIFrame(iframe: HTMLIFrameElement): BaseMessageTransport {
	if (typeof window === "undefined") {
		throw new Error(`call this function from the main browser thread`);
	}
	return new WindowLikeTransport(iframe.contentWindow!, iframe.contentWindow!, {
		loaded: window.document.readyState === "complete",
		onLoaded: new Promise((res) => {
			window.addEventListener("load", () => res());
		}),
	});
}
