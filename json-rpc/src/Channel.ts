import {
	RequestId,
	ErrorObject,
	JSONValue,
	JSONArray,
	JSONObject,
} from "./JsonRpcTypes";

/**
 * A channel has methods to send requests and notifications.
 * A request expects a response, a notification does not.
 */
export interface Channel<TContext = void> {
	/**
	 * Sends a request.
	 * @param request - The request to send.
	 * @param messageIdCallback - An optional callback that is called before sending the request.
	 *  		The passed request id can be used to track the request.
	 * @return A promise of the response. Fails if the request could not be delivered or if a response could not be received.
	 */
	sendRequest(
		request: RequestObject,
		context: TContext,
		messageIdCallback?: (requestId: RequestId) => void
	): Promise<ResponseObject>;

	/**
	 * Sends a notification.
	 * @return A promise that is fulfilled as soon as the notification has been sent successfully.
	 *  	Fails if the notification could not be sent.
	 */
	sendNotification(
		notification: RequestObject,
		context: TContext
	): Promise<void>;

	/**
	 * Returns human readable information of this channel.
	 */
	toString(): string;
}

/**
 * A request handler can handle requests and notifications.
 * Implementations must respond to all requests.
 */
export interface RequestHandler<TContext = void> {
	/**
	 * Handles an incoming request.
	 */
	handleRequest(
		request: RequestObject,
		requestId: RequestId,
		context: TContext
	): Promise<ResponseObject>;
	handleNotification(
		request: RequestObject,
		context: TContext
	): Promise<void>;
}

/**
 * Represents a request.
 * The `method` property should be used for deciding what to do with it.
 */
export interface RequestObject {
	method: string;
	// Compared to RequestMessage, params must be set, but can be null.
	// This is designed so that null can be handled by the deserializer
	// which undefined cannot.
	params: JSONArray | JSONObject | null;
}

/**
 * The result of a request.
 */
export type ResponseObject =
	| {
			result: JSONValue;
	  }
	| {
			error: ErrorObject;
	  };

/**
 * A factory for `Channel`s.
 * Is used to delay setting a `RequestHandler`.
 * Once a channel is constructed, it processes all incoming messages.
 */
export class ChannelFactory<TContext = void, TChannelContext = void> {
	constructor(
		public readonly createChannel: (
			listener: RequestHandler<TContext> | undefined
		) => Channel<TChannelContext>
	) {}

	public mapContext<TNewContext>(
		map: (context: TContext) => TNewContext
	): ChannelFactory<TNewContext, TChannelContext> {
		return new ChannelFactory<TNewContext, TChannelContext>((listener) =>
			this.createChannel(
				listener ? mapRequestHandlerContext(listener, map) : undefined
			)
		);
	}
}

/**
 * Implements a channel that directly forwards the requests to the given request handler.
 */
export class LoopbackChannel<TContext> implements Channel<TContext> {
	private id: number = 0;

	constructor(private readonly requestHandler: RequestHandler<TContext>) {}

	public sendRequest(
		request: RequestObject,
		context: TContext,
		messageIdCallback?: (requestId: RequestId) => void
	): Promise<ResponseObject> {
		const curId = this.id++;
		if (messageIdCallback) {
			messageIdCallback(curId);
		}
		return this.requestHandler.handleRequest(request, curId, context);
	}

	public sendNotification(
		notification: RequestObject,
		context: TContext
	): Promise<void> {
		return this.requestHandler.handleNotification(notification, context);
	}

	public toString(): string {
		return "Loopback";
	}
}

export function mapChannelContext<TContext, TNewContext>(
	channel: Channel<TContext>,
	map: (context: TNewContext) => TContext
): Channel<TNewContext> {
	return {
		sendNotification: (notification, context) =>
			channel.sendNotification(notification, map(context)),
		sendRequest: (request, context, messageIdCallback) =>
			channel.sendRequest(request, map(context), messageIdCallback),

		toString: () => channel.toString(),
	};
}

export function mapRequestHandlerContext<TContext, TNewContext>(
	requestHandler: RequestHandler<TContext>,
	map: (context: TNewContext) => TContext
): RequestHandler<TNewContext> {
	return {
		handleNotification: (request, context) =>
			requestHandler.handleNotification(request, map(context)),
		handleRequest: (request, requestId, context) =>
			requestHandler.handleRequest(request, requestId, map(context)),
	};
}
