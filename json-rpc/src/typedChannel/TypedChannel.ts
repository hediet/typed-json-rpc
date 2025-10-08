import { IRequestSender, Channel, RequestObject, ResponseObject } from "../Channel";
import { RequestId, ErrorCode, JSONValue, JSONArray, JSONObject } from "../JsonRpcTypes";
import { RpcLogger } from "../Logger";
import { IMessageTransport } from "../MessageTransport";
import { StreamBasedChannel } from "../StreamBasedChannel";
import { createTimeout, Deferred, EventEmitter, IDisposable, setAndDeleteOnDispose } from "../common";
import { convertSerializer, ISerializer, Serializers, SerializerTAny } from "../schema";

export const OptionalMethodNotFound = Symbol("OptionalMethodNotFound");
export type OptionalMethodNotFound = typeof OptionalMethodNotFound;

export abstract class TypedChannelBase<TContext, TSendContext> {
	public abstract request<TParams, TResponse, TOptional extends boolean>(
		requestType: RequestType<TParams, TResponse, unknown, string | undefined, TOptional>,
		args: TParams,
		context: TSendContext
	): Promise<TOptional extends true ? TResponse | OptionalMethodNotFound : TResponse>;

	public abstract notify<TParams>(
		notificationType: NotificationType<TParams>,
		params: TParams,
		context: TSendContext
	): void;

	public abstract registerNotificationHandler<TArgs>(
		type: NotificationType<TArgs>,
		handler: NotificationHandlerFunc<TArgs, TContext>
	): IDisposable;

	public abstract registerRequestHandler<TArgs, TResponse, TError>(
		requestType: RequestType<TArgs, TResponse, TError>,
		handler: RequestHandlerFunc<TArgs, TResponse, TError, TContext>
	): IDisposable;

	public contextualize<TNewContext, TNewSendContext>(args: {
		getNewContext: (context: TContext) => Promise<TNewContext> | TNewContext;
		getSendContext: (newSendContext: TNewSendContext) => Promise<TSendContext> | TSendContext;
	}): TypedChannelBase<TNewContext, TNewSendContext> {
		return new ContextualizedTypedChannel(this, args);
	}
}

class ContextualizedTypedChannel<
	TNewContext,
	TNewSendContext,
	TContext,
	TSendContext
> extends TypedChannelBase<TNewContext, TNewSendContext> {
	constructor(
		private readonly underylingTypedChannel: TypedChannelBase<
			TContext,
			TSendContext
		>,
		private readonly converters: {
			getNewContext: (
				context: TContext
			) => Promise<TNewContext> | TNewContext;
			getSendContext: (
				newSendContext: TNewSendContext
			) => Promise<TSendContext> | TSendContext;
		}
	) {
		super();
	}

	public async request<TParams, TResponse, TOptional extends boolean>(
		requestType: RequestType<TParams, TResponse, unknown, string, TOptional>,
		args: TParams,
		newContext: TNewSendContext
	): Promise<TOptional extends true ? TResponse | OptionalMethodNotFound : TResponse> {
		const context = await this.converters.getSendContext(newContext);
		return this.underylingTypedChannel.request(requestType, args, context);
	}

	public async notify<TParams>(
		notificationType: NotificationType<TParams>,
		params: TParams,
		newContext: TNewSendContext
	): Promise<void> {
		const context = await this.converters.getSendContext(newContext);
		return this.underylingTypedChannel.notify(
			notificationType,
			params,
			context
		);
	}

	public registerNotificationHandler<TArgs>(
		type: NotificationType<TArgs>,
		handler: NotificationHandlerFunc<TArgs, TNewContext>
	): IDisposable {
		return this.underylingTypedChannel.registerNotificationHandler(
			type,
			async (arg, context) => {
				const newContext = await this.converters.getNewContext(context);
				return await handler(arg, newContext);
			}
		);
	}

	public registerRequestHandler<TArgs, TResponse, TError>(
		requestType: RequestType<TArgs, TResponse, TError>,
		handler: RequestHandlerFunc<TArgs, TResponse, TError, TNewContext>
	): IDisposable {
		return this.underylingTypedChannel.registerRequestHandler(
			requestType,
			async (arg, requestId, context) => {
				const newContext = await this.converters.getNewContext(context);
				return await handler(arg, requestId, newContext);
			}
		);
	}
}

export interface TypedChannelOptions {
	logger?: RpcLogger;
	/**
	 * If true, any sent or received unexpected properties are ignored.
	 */
	ignoreUnexpectedPropertiesInResponses?: boolean;
	sendExceptionDetails?: boolean;
}

/**
 * Represents a typed channel.
 * Call `startListen` to create the underlying channel
 * and to start processing all incoming messages.
 * At this point, all request and notification handlers should be registered.
 */
export class TypedChannel<TContext = void, TSendContext = void> extends TypedChannelBase<TContext, TSendContext> {
	public static fromTransport(stream: IMessageTransport, options: TypedChannelOptions = {}): TypedChannel {
		const channelFactory = StreamBasedChannel.createChannel(stream, options.logger);
		return new TypedChannel(channelFactory, options);
	}

	private _requestSender: IRequestSender<TSendContext> | undefined = undefined;
	private readonly _handler = new Map<
		string,
		| RegisteredRequestHandler<any, any, any, TContext>
		| RegisteredNotificationHandler<any, TContext>
	>();
	private readonly _unknownNotificationHandler = new Set<
		(notification: RequestObject) => void
	>();
	private _timeout: IDisposable | undefined;
	public sendExceptionDetails: boolean = false;

	private readonly _logger: RpcLogger | undefined;

	constructor(
		private readonly channelCtor: Channel<TContext, TSendContext>,
		options: TypedChannelOptions = {}
	) {
		super();
		this._logger = options.logger;
		this.sendExceptionDetails = !!options.sendExceptionDetails;

		this._timeout = createTimeout(1000, () => {
			if (!this._requestSender) {
				console.warn(
					`"${this.startListen.name}" has not been called within 1 second after construction of this channel. ` +
					`Did you forget to call it?`,
					this
				);
			}
		});
	}

	private listeningDeferred = new Deferred();
	public onListening: Promise<void> = this.listeningDeferred.promise;

	private readonly _requestDidErrorEventEmitter = new EventEmitter<{ error: RequestHandlingError; }>();
	public readonly onRequestDidError = this._requestDidErrorEventEmitter.event;

	/**
	 * This method must be called to forward messages from the stream to this channel.
	 * This is not done automatically on construction so that this instance
	 * can be setup properly before handling messages.
	 */
	public startListen(): void {
		if (this._requestSender) {
			throw new Error(
				`"${this.startListen.name}" can be called only once, but it already has been called.`
			);
		}
		if (this._timeout) {
			this._timeout.dispose();
			this._timeout = undefined;
		}
		this._requestSender = this.channelCtor.connect({
			handleRequest: (req, id, context) =>
				this.handleRequest(req, id, context),
			handleNotification: (req, context) =>
				this.handleNotification(req, context),
		});

		this.listeningDeferred.resolve();
	}

	private checkChannel(
		channel: IRequestSender<TSendContext> | undefined
	): channel is IRequestSender<TSendContext> {
		if (!channel) {
			throw new Error(
				`"${this.startListen.name}" must be called before any messages can be sent or received.`
			);
		}
		return true;
	}

	private async handleRequest(
		request: RequestObject,
		requestId: RequestId,
		context: TContext
	): Promise<ResponseObject> {
		const handler = this._handler.get(request.method) as
			| RegisteredRequestHandler<
				{ brand: "params" },
				{ brand: "result" },
				{ brand: "error" },
				TContext
			>
			| RegisteredNotificationHandler<{ brand: "params" }, TContext>
			| undefined;

		if (!handler) {
			if (this._logger) {
				this._logger.debug({
					text: `No request handler for "${request.method}".`,
					data: { requestObject: request },
				});
			}

			return {
				error: {
					code: ErrorCode.methodNotFound,
					message: `No request handler for "${request.method}".`,
					data: { method: request.method },
				},
			};
		}

		if (handler.kind != "request") {
			const message = `"${request.method}" is registered as notification, but was sent as request.`;

			if (this._logger) {
				this._logger.debug({
					text: message,
					data: { requestObject: request },
				});
			}

			return {
				error: {
					code: ErrorCode.invalidRequest,
					message: message,
					data: { method: request.method },
				},
			};
		}

		const decodeResult = handler.requestType.paramsSerializer.deserializeFromJson(request.params);
		if (decodeResult.hasErrors) {
			const message = `Got invalid params: ${decodeResult.errorMessage}`;

			if (this._logger) {
				this._logger.debug({
					text: message,
					data: {
						requestObject: request,
						errorMessage: decodeResult.errorMessage,
					},
				});
			}

			return {
				error: {
					code: ErrorCode.invalidParams,
					message,
					data: {
						errors: decodeResult.errorMessage,
					},
				},
			};
		} else {
			const args = decodeResult.value;
			let response: ResponseObject;
			try {
				const result = await handler.handler(args, requestId, context);
				if ("error" in result || "errorMessage" in result) {
					const errorData = result.error
						? (handler.requestType.errorSerializer.serializeToJson(result.error))
						: undefined;

					const code = result.errorCode || ErrorCode.genericApplicationError;
					const message = result.errorMessage || "An error was returned";
					response = { error: { code, message, data: errorData } };
				} else {
					const val = handler.requestType.resultSerializer.serializeToJson(result.ok);
					response = { result: val };
				}
			} catch (exception) {
				if (exception instanceof RequestHandlingError) {
					//  TODO: Introduce a better custom error
					// What about data?
					// Maybe default error data should be unknown
					response = {
						error: {
							code: exception.code,
							message: exception.message,
						},
					};
				} else {
					if (this._logger) {
						this._logger.warn({
							text: `An exception was thrown while handling a request: ${exception}.`,
							exception,
							data: { requestObject: request },
						});
					}
					response = {
						error: {
							code: ErrorCode.unexpectedServerError,
							message: this.sendExceptionDetails
								? `An exception was thrown while handling a request: ${exception}.`
								: "Server has thrown an unexpected exception",
						},
					};
				}
			}
			return response;
		}
	}

	private async handleNotification(
		request: RequestObject,
		context: TContext
	): Promise<void> {
		const handler = this._handler.get(request.method);
		if (!handler) {
			for (const h of this._unknownNotificationHandler) {
				h(request);
			}
			if (this._unknownNotificationHandler.size === 0) {
				if (this._logger) {
					this._logger.debug({
						text: `Unhandled notification "${request.method}"`,
						data: { requestObject: request },
					});
				}
			}
			return;
		}

		if (handler.kind != "notification") {
			if (this._logger) {
				this._logger.debug({
					text: `"${request.method}" is registered as request, but was sent as notification.`,
					data: { requestObject: request },
				});
			}

			// dont send a response back as we are handling a notification.
			return;
		}

		const decodeResult = handler.notificationType.paramsSerializer.deserializeFromJson(request.params);
		if (decodeResult.hasErrors) {
			if (this._logger) {
				this._logger.debug({
					text: `Got invalid params: ${decodeResult}`,
					data: {
						requestObject: request,
						errorMessage: decodeResult.errorMessage,
					},
				});
			}

			// dont send a response back as we are handling a notification.
			return;
		}
		const val = decodeResult.value;

		for (const handlerFunc of handler.handlers) {
			try {
				handlerFunc(val, context);
			} catch (exception) {
				if (this._logger) {
					this._logger.warn({
						text: `An exception was thrown while handling a notification: ${exception}.`,
						exception,
						data: { requestObject: request },
					});
				}
			}
		}
	}

	public registerUnknownNotificationHandler(
		handler: (notification: RequestObject) => void
	): IDisposable {
		return setAndDeleteOnDispose(this._unknownNotificationHandler, handler);
	}

	public registerRequestHandler<TArgs, TResponse, TError>(
		requestType: RequestType<TArgs, TResponse, TError>,
		handler: RequestHandlerFunc<TArgs, TResponse, TError, TContext>
	): IDisposable {
		const registeredHandler = this._handler.get(requestType.method);
		if (registeredHandler) {
			throw new Error(
				`Handler with method "${requestType.method}" already registered.`
			);
		}

		return setAndDeleteOnDispose(this._handler, requestType.method, {
			kind: "request",
			requestType,
			handler,
		});
	}

	public registerNotificationHandler<TArgs>(
		type: NotificationType<TArgs>,
		handler: NotificationHandlerFunc<TArgs, TContext>
	): IDisposable {
		let registeredHandler = this._handler.get(type.method);
		if (!registeredHandler) {
			registeredHandler = {
				kind: "notification",
				notificationType: type,
				handlers: new Set(),
			};
			this._handler.set(type.method, registeredHandler);
		} else {
			if (registeredHandler.kind !== "notification") {
				throw new Error(
					`Method "${type.method}" was already registered as request handler.`
				);
			}
			if (registeredHandler.notificationType !== type) {
				throw new Error(
					`Method "${type.method}" was registered for a different type.`
				);
			}
		}

		return setAndDeleteOnDispose(registeredHandler.handlers, handler);
	}

	public getRegisteredTypes(): Array<RequestType | NotificationType> {
		const result = [];
		for (const h of this._handler.values()) {
			if (h.kind === "notification") {
				result.push(h.notificationType);
			} else if (h.kind === "request") {
				result.push(h.requestType);
			}
		}
		return result;
	}

	public async request<TParams, TResponse, TOptional extends boolean>(
		requestType: RequestType<TParams, TResponse, unknown, string, TOptional>,
		args: TParams,
		context: TSendContext
	): Promise<TOptional extends true ? TResponse | OptionalMethodNotFound : TResponse> {
		if (!this.checkChannel(this._requestSender)) {
			throw new Error("Impossible");
		}

		const params = requestType.paramsSerializer.serializeToJson(args);

		assertObjectArrayOrNull(params);

		const response = await this._requestSender.sendRequest(
			{
				method: requestType.method,
				params,
			},
			context
		);

		if ("error" in response) {
			if (requestType.isOptional && response.error.code === ErrorCode.methodNotFound) {
				return OptionalMethodNotFound as any;
			}

			let errorData;
			if (response.error.data !== undefined) {
				const deserializationResult = requestType.errorSerializer.deserializeFromJson(
					response.error.data
				);
				if (deserializationResult.hasErrors) {
					throw new Error(deserializationResult.errorMessage);
				}
				errorData = deserializationResult.value;
			} else {
				errorData = undefined;
			}

			const error = new RequestHandlingError(response.error.message, errorData, response.error.code);
			this._requestDidErrorEventEmitter.fire({ error });
			throw error;
		} else {
			const result = requestType.resultSerializer.deserializeFromJson(response.result);
			if (result.hasErrors) {
				throw new Error('Could not deserialize response: ' + result.errorMessage + `\n\n${JSON.stringify(response, null, 2)}`);
			} else {
				return result.value;
			}
		}
	}

	public async notify<TParams>(
		notificationType: NotificationType<TParams>,
		params: TParams,
		context: TSendContext
	): Promise<void> {
		if (!this.checkChannel(this._requestSender)) {
			throw new Error();
		}

		const encodedParams = notificationType.paramsSerializer.serializeToJson(params);

		assertObjectArrayOrNull(encodedParams);

		this._requestSender.sendNotification({ method: notificationType.method, params: encodedParams }, context);
	}

	/*public requestAndCatchError(connection: Connection, body: TRequest): Promise<Result<TResponse, TError>> {

	}*/
}

function assertObjectArrayOrNull(
	val: JSONValue
): asserts val is JSONObject | JSONArray | null {
	if (val !== null && Array.isArray(val) && typeof val !== "object") {
		throw new Error(
			"Invalid value! Only null, array and object is allowed."
		);
	}
}

export type Result<TOk, TError> = OkResult<TOk> | ErrorResult<TError>;

export interface OkResult<TOk> {
	ok: TOk;
}

export type ErrorResult<TError> =
	| {
		error: TError;
		errorMessage?: string;
		errorCode?: ErrorCode;
	}
	| {
		error?: TError;
		errorMessage: string;
		errorCode?: ErrorCode;
	};

export type RequestHandlerFunc<TArg, TResult, TError, TContext> = (
	arg: TArg,
	requestId: RequestId,
	context: TContext
) => Promise<Result<TResult, TError>>;

export type NotificationHandlerFunc<TArg, TContext> = (
	arg: TArg,
	context: TContext
) => void;

interface RegisteredRequestHandler<TArg, TResult, TError, TContext> {
	readonly kind: "request";
	readonly requestType: RequestType<TArg, TResult, TError>;
	readonly handler: RequestHandlerFunc<TArg, TResult, TError, TContext>;
}

interface RegisteredNotificationHandler<TArg, TContext> {
	readonly kind: "notification";
	readonly notificationType: NotificationType<TArg>;
	readonly handlers: Set<NotificationHandlerFunc<TArg, TContext>>;
}

/**
 * Is thrown when handling the request raised an error.
 */
export class RequestHandlingError<T = any> extends Error {
	constructor(
		message: string,
		public readonly data?: T,
		public readonly code: ErrorCode = ErrorCode.genericApplicationError
	) {
		super(message);
		Object.setPrototypeOf(this, RequestHandlingError.prototype);
	}
}

/**
 * Describes a request type.
 */
export class RequestType<
	TParams = unknown,
	TResponse = unknown,
	TError = unknown,
	TMethod extends string | undefined = string,
	TOptional extends boolean = false,
> {
	public readonly kind: "request" = "request";

	constructor(
		public readonly method: TMethod,
		public readonly paramsSerializer: ISerializer<TParams>,
		public readonly resultSerializer: ISerializer<TResponse>,
		public readonly errorSerializer: ISerializer<TError>,
		public readonly isOptional: TOptional = false as TOptional,
	) { }

	public withMethod(
		method: string
	): RequestType<TParams, TResponse, TError, string> {
		return new RequestType(
			method,
			this.paramsSerializer,
			this.resultSerializer,
			this.errorSerializer
		);
	}

	public optional(): RequestType<TParams, TResponse, TError, TMethod, true> {
		return new RequestType(
			this.method,
			this.paramsSerializer,
			this.resultSerializer,
			this.errorSerializer,
			true as true
		);
	}
}

/**
 * Describes a notification type.
 */
export class NotificationType<TParams = unknown, TMethod = string> {
	public readonly kind: "notification" = "notification";

	constructor(
		public readonly method: TMethod,
		public readonly paramsSerializer: ISerializer<TParams>
	) { }

	public withMethod(method: string): NotificationType<TParams, string> {
		return new NotificationType(method, this.paramsSerializer);
	}
}

/**
 * Describes a notification type without static type validation.
 */
export function rawNotification(
	method: string
): NotificationType<JSONObject | JSONArray | undefined> {
	return new NotificationType(method, Serializers.sAny());
}

/**
 * Describes a request type as part of a `Contract`.
 */
export function requestType<
	TMethod extends string | undefined = undefined,
	TParams = ISerializer<{}>,
	TResult = ISerializer<void>,
	TError = ISerializer<undefined>
>(request: {
	method?: TMethod;
	params?: TParams;
	result?: TResult;
	error?: TError;
}): RequestType<SerializerTAny<TParams>, SerializerTAny<TResult>, SerializerTAny<TError>, TMethod> {
	return new RequestType(
		request.method!,
		request.params ? convertSerializer(request.params) as any : Serializers.sEmptyObject(),
		request.result ? convertSerializer(request.result) as any : Serializers.sVoidFromNull(),
		request.error ? convertSerializer(request.error) as any : Serializers.sVoidFromNull()
	);
}

// TODO remove TMethod
export function unverifiedRequest<
	TParams = {},
	TResult = void,
	TError = void,
	TMethod extends string | undefined = string
>(request?: {
	method?: TMethod;
}): RequestType<TParams, TResult, TError, TMethod> {
	return new RequestType((request || {}).method!, Serializers.sAny(), Serializers.sAny(), Serializers.sAny());
}

/**
 * Describes a notification type as part of a `Contract`.
 */
export function notificationType<
	TMethod extends string | undefined = undefined,
	TParams = ISerializer<{}>
>(notification: {
	method?: TMethod;
	params?: TParams;
}): NotificationType<SerializerTAny<TParams>, TMethod> {
	return new NotificationType(
		notification.method!,
		notification.params ? convertSerializer(notification.params) as any : Serializers.sEmptyObject()
	);
}

// TODO remove TMethod
export function unverifiedNotification<TParams, TMethod extends string | undefined = string>
	(request?: { method?: TMethod }
	): NotificationType<TParams, TMethod> {
	return new NotificationType((request || {}).method!, Serializers.sAny());
}
