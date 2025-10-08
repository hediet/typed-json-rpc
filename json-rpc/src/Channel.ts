import { constValue, IValueWithChangeEvent } from "./common";
import {
	RequestId,
	ErrorObject,
	JSONValue,
	JSONArray,
	JSONObject,
} from "./JsonRpcTypes";
import { ConnectionState } from "./MessageTransport";

/**
 * Once a channel is constructed, it processes all incoming messages.
 */
export class Channel<TContext = void, TSenderContext = void> {
	constructor(
		public readonly connect: (listener: IRequestHandler<TContext> | undefined) => IRequestSender<TSenderContext>
	) { }

	public mapContext<TNewContext>(map: (context: TContext) => TNewContext): Channel<TNewContext, TSenderContext> {
		return new Channel<TNewContext, TSenderContext>((listener) =>
			this.connect(listener ? mapRequestHandlerContext(listener, map) : undefined)
		);
	}
}

/**
 * A message sender has methods to send requests and notifications.
 * A request expects a response, a notification does not.
 */
export interface IRequestSender<TContext = void> {
	/**
	 * Sends a request.
	 * @param request - The request to send.
	 * @param messageIdCallback - An optional callback that is called before sending the request.
	 *  		The passed request id can be used to track the request.
	 * @return A promise of the response. Fails if the request could not be delivered or if a response could not be received.
	 */
	sendRequest(request: RequestObject, context: TContext, messageIdCallback?: (id: RequestId) => void): Promise<ResponseObject>;

	/**
	 * Sends a notification.
	 * @return A promise that is fulfilled as soon as the notification has been sent successfully.
	 *  	Fails if the notification could not be sent.
	 */
	sendNotification(notification: RequestObject, context: TContext): Promise<void>;

	/**
	 * Returns human readable information of this channel.
	 */
	toString(): string;

	get state(): IValueWithChangeEvent<ConnectionState>;
}

/**
 * A request handler can handle requests and notifications.
 * Implementations must respond to all requests.
 */
export interface IRequestHandler<TContext = void> {
	/**
	 * Handles an incoming request.
	 */
	handleRequest(request: RequestObject, requestId: RequestId, context: TContext): Promise<ResponseObject>;
	handleNotification(request: RequestObject, context: TContext): Promise<void>;
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
	| { result: JSONValue }
	| { error: ErrorObject };


/**
 * Implements a channel that directly forwards the requests to the given request handler.
 */
export class LoopbackChannel<TContext> implements IRequestSender<TContext> {
	private id: number = 0;

	constructor(private readonly requestHandler: IRequestHandler<TContext>) { }

	public sendRequest(request: RequestObject, context: TContext, messageIdCallback?: (id: RequestId) => void): Promise<ResponseObject> {
		const curId = this.id++;
		if (messageIdCallback) {
			messageIdCallback(curId);
		}
		return this.requestHandler.handleRequest(request, curId, context);
	}

	public sendNotification(notification: RequestObject, context: TContext): Promise<void> {
		return this.requestHandler.handleNotification(notification, context);
	}

	public toString(): string {
		return "Loopback";
	}

	public readonly state = constValue<ConnectionState>({ state: "open" });
}

export function mapMessageSenderContext<TContext, TNewContext>(
	messageSender: IRequestSender<TContext>,
	map: (context: TNewContext) => TContext
): IRequestSender<TNewContext> {
	return {
		sendNotification: (notification, context) =>
			messageSender.sendNotification(notification, map(context)),
		sendRequest: (request, context, messageIdCallback) =>
			messageSender.sendRequest(request, map(context), messageIdCallback),

		toString: () => messageSender.toString(),
		state: messageSender.state,
	};
}

export function mapRequestHandlerContext<TContext, TNewContext>(
	messageHandler: IRequestHandler<TContext>,
	map: (context: TNewContext) => TContext
): IRequestHandler<TNewContext> {
	return {
		handleNotification: (request, context) =>
			messageHandler.handleNotification(request, map(context)),
		handleRequest: (request, requestId, context) =>
			messageHandler.handleRequest(request, requestId, map(context)),
	};
}
