import { RequestId, ErrorObject, JSONValue } from "./JsonRpcTypes";

export interface RequestObject {
	method: string;
	params?: JSONValue[] | Record<string, JSONValue>;
}

export type ResponseObject =
	| {
			result: JSONValue;
	  }
	| {
			error: ErrorObject;
	  };

/**
 * A channel has methods to send requests and notifications.
 * A request expects a response, a notification does not.
 */
export interface Channel {
	/**
	 * Sends a request.
	 * @param request - The request to send.
	 * @param messageIdCallback - An optional callback that is called before sending the request.
	 * 			The passed request id can be used to track the request.
	 * @return A promise of the response. Fails if the request could not be delivered or if an response could not be received.
	 */
	sendRequest(
		request: RequestObject,
		messageIdCallback?: (requestId: RequestId) => void
	): Promise<ResponseObject>;

	/**
	 * Sends a notification.
	 * @return A promise that is fulfilled as soon as the notification has been sent successfully.
	 *      Fails if the notification could not be delivered.
	 */
	sendNotification(notification: RequestObject): Promise<void>;

	/**
	 * Returns human readable information of this channel.
	 */
	toString(): string;
}

/**
 * A request handler is an object that can handle requests and notifications.
 * Implementations must respond to all requests.
 */
export interface RequestHandler {
	/**
	 * Handles an incoming request.
	 */
	handleRequest(
		request: RequestObject,
		requestId: RequestId
	): Promise<ResponseObject>;
	handleNotification(request: RequestObject): Promise<void>;
}

/**
 * A factory for `Channel`s.
 * Is used to delay setting a `RequestHandler`.
 * Once a channel is constructed, it processes all incoming messages.
 */
export interface ChannelFactory {
	createChannel(listener: RequestHandler | undefined): Channel;
}

/**
 * Implements a channel that directly forwards the requests to the given request handler.
 */
export class LoopbackChannel implements Channel {
	private id: number = 0;

	constructor(private readonly requestHandler: RequestHandler) {}

	public sendRequest(
		request: RequestObject,
		messageIdCallback?: (requestId: RequestId) => void
	): Promise<ResponseObject> {
		const curId = this.id++;
		if (messageIdCallback) {
			messageIdCallback(curId);
		}
		return this.requestHandler.handleRequest(request, curId);
	}

	public sendNotification(notification: RequestObject): Promise<void> {
		return this.requestHandler.handleNotification(notification);
	}

	public toString(): string {
		return "Loopback";
	}
}
