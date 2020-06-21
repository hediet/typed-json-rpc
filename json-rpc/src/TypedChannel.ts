import {
	Serializer,
	sAny,
	sObject,
	BaseSerializer,
	sNull,
} from "@hediet/semantic-json";
import { Disposable } from "@hediet/std/disposable";
import {
	Channel,
	ChannelFactory,
	RequestObject,
	ResponseObject,
} from "./Channel";
import {
	RequestId,
	ErrorCode,
	JSONValue,
	JSONArray,
	JSONObject,
} from "./JsonRpcTypes";
import { RpcLogger } from "./Logger";
import { MessageStream } from "./MessageStream";
import { Deferred } from "@hediet/std/synchronization";
import { startTimeout } from "@hediet/std/timer";
import { StreamBasedChannel } from "./StreamBasedChannel";
import { EventEmitter } from "@hediet/std/events";

/**
 * Represents a typed channel.
 * Call `startListen` to create the underlying channel
 * and to start processing all incoming messages.
 * At this point, all request and notification handlers should be registered.
 */
export class TypedChannel {
	public static fromStream(
		stream: MessageStream,
		logger: RpcLogger | undefined
	): TypedChannel {
		const channelFactory = StreamBasedChannel.getFactory(stream, logger);
		return new TypedChannel(channelFactory, logger);
	}

	private channel: Channel | undefined = undefined;
	private readonly handler = new Map<
		string,
		RegisteredRequestHandler | RegisteredNotificationHandler
	>();
	private readonly unknownNotificationHandler = new Set<
		(notification: RequestObject) => void
	>();
	private timeout: Disposable | undefined;
	public sendExceptionDetails: boolean = false;

	constructor(
		private readonly channelCtor: ChannelFactory,
		private readonly logger: RpcLogger | undefined
	) {
		if (process.env.NODE_ENV !== "production") {
			this.timeout = startTimeout(1000, () => {
				if (!this.channel) {
					console.warn(
						`"${this.startListen.name}" has not been called within 1 second after construction of this channel. ` +
							`Did you forget to call it?`,
						this
					);
				}
			});
		}
	}

	private listeningDeferred = new Deferred();
	public onListening: Promise<void> = this.listeningDeferred.promise;

	private readonly requestDidErrorEventEmitter = new EventEmitter<{
		error: RequestHandlingError;
	}>();
	public readonly onRequestDidError = this.requestDidErrorEventEmitter.asEvent();

	/**
	 * This method must be called to forward messages from the stream to this channel.
	 * This is not done automatically on construction so that this instance
	 * can be setup properly before handling messages.
	 */
	public startListen(): void {
		if (this.channel) {
			throw new Error(
				`"${this.startListen.name}" can be called only once, but it already has been called.`
			);
		}
		if (this.timeout) {
			this.timeout.dispose();
			this.timeout = undefined;
		}
		this.channel = this.channelCtor.createChannel({
			handleRequest: (req, id) => this.handleRequest(req, id),
			handleNotification: (req) => this.handleNotification(req),
		});

		this.listeningDeferred.resolve();
	}

	private checkChannel(channel: Channel | undefined): channel is Channel {
		if (!channel) {
			throw new Error(
				`"${this.startListen.name}" must be called before any messages can be sent or received.`
			);
		}
		return true;
	}

	private async handleRequest(
		request: RequestObject,
		requestId: RequestId
	): Promise<ResponseObject> {
		const handler = this.handler.get(request.method) as
			| RegisteredRequestHandler<
					{ brand: "params" },
					{ brand: "result" },
					{ brand: "error" }
			  >
			| RegisteredNotificationHandler<{ brand: "params" }>
			| undefined;

		if (!handler) {
			if (this.logger) {
				this.logger.debug({
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

			if (this.logger) {
				this.logger.debug({
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

		const decodeResult = handler.requestType.paramsSerializer.deserialize(
			request.params
		);
		if (decodeResult.hasErrors) {
			const message = `Got invalid params: ${decodeResult.formatError()}`;

			if (this.logger) {
				this.logger.debug({
					text: message,
					data: {
						requestObject: request,
						errors: decodeResult.errors,
					},
				});
			}

			return {
				error: {
					code: ErrorCode.invalidParams,
					message,
					data: {
						errors: decodeResult.errors.map(
							(e) => e.message || null
						),
					},
				},
			};
		} else {
			const args = decodeResult.value;
			let response: ResponseObject;
			try {
				const result = await handler.handler(args, requestId);
				if ("error" in result || "errorMessage" in result) {
					const errorData = result.error
						? handler.requestType.errorSerializer.serialize(
								result.error
						  )
						: undefined;

					const code =
						result.errorCode || ErrorCode.genericApplicationError;
					const message =
						result.errorMessage || "An error was returned";
					response = {
						error: {
							code,
							message,
							data: errorData,
						},
					};
				} else {
					const val = handler.requestType.resultSerializer.serialize(
						result.ok
					);
					response = { result: val };
				}
			} catch (exception) {
				if (this.logger) {
					this.logger.warn({
						text: `An exception was thrown while handling a request: ${exception.toString()}.`,
						exception,
						data: { requestObject: request },
					});
				}

				response = {
					error: {
						code: ErrorCode.unexpectedServerError,
						message: this.sendExceptionDetails
							? `An exception was thrown while handling a request: ${exception.toString()}.`
							: "Server has thrown an unexpected exception",
					},
				};
			}
			return response;
		}
	}

	private async handleNotification(request: RequestObject): Promise<void> {
		const handler = this.handler.get(request.method);
		if (!handler) {
			for (const h of this.unknownNotificationHandler) {
				h(request);
			}
			if (this.unknownNotificationHandler.size === 0) {
				if (this.logger) {
					this.logger.debug({
						text: `Unhandled notification "${request.method}"`,
						data: { requestObject: request },
					});
				}
			}
			return;
		}

		if (handler.kind != "notification") {
			if (this.logger) {
				this.logger.debug({
					text: `"${request.method}" is registered as request, but was sent as notification.`,
					data: { requestObject: request },
				});
			}

			// dont send a response back as we are handling a notification.
			return;
		}

		const decodeResult = handler.notificationType.paramsSerializer.deserialize(
			request.params
		);
		if (decodeResult.hasErrors) {
			if (this.logger) {
				this.logger.debug({
					text: `Got invalid params: ${decodeResult.formatError()}`,
					data: {
						requestObject: request,
						errors: decodeResult.errors,
					},
				});
			}

			// dont send a response back as we are handling a notification.
			return;
		}
		const val = decodeResult.value;

		for (const handlerFunc of handler.handlers) {
			try {
				handlerFunc(val);
			} catch (exception) {
				if (this.logger) {
					this.logger.warn({
						text: `An exception was thrown while handling a notification: ${exception.toString()}.`,
						exception,
						data: { requestObject: request },
					});
				}
			}
		}

		return;
	}

	public registerUnknownNotificationHandler(
		handler: (notification: RequestObject) => void
	): Disposable {
		return setAndDeleteOnDispose(this.unknownNotificationHandler, handler);
	}

	public registerRequestHandler<TArgs, TResponse, TError>(
		requestType: RequestType<TArgs, TResponse, TError>,
		handler: RequestHandlerFunc<TArgs, TResponse, TError>
	): Disposable {
		const registeredHandler = this.handler.get(requestType.method);
		if (registeredHandler) {
			throw new Error(
				`Handler with method "${requestType.method}" already registered.`
			);
		}

		return setAndDeleteOnDispose(this.handler, requestType.method, {
			kind: "request",
			requestType,
			handler,
		});
	}

	public registerNotificationHandler<TArgs>(
		type: NotificationType<TArgs>,
		handler: NotificationHandlerFunc<TArgs>
	): Disposable {
		let registeredHandler = this.handler.get(type.method);
		if (!registeredHandler) {
			registeredHandler = {
				kind: "notification",
				notificationType: type,
				handlers: new Set(),
			};
			this.handler.set(type.method, registeredHandler);
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
		for (const h of this.handler.values()) {
			if (h.kind === "notification") {
				result.push(h.notificationType);
			} else if (h.kind === "request") {
				result.push(h.requestType);
			}
		}
		return result;
	}

	public async request<TParams, TResponse>(
		requestType: RequestType<TParams, TResponse, unknown>,
		args: TParams
	): Promise<TResponse> {
		if (!this.checkChannel(this.channel)) {
			throw new Error("Impossible");
		}

		const params = requestType.paramsSerializer.serialize(args);

		assertObjectArrayOrNull(params);

		const response = await this.channel.sendRequest({
			method: requestType.method,
			params,
		});

		if ("error" in response) {
			let errorData;
			if (response.error.data !== undefined) {
				const deserializationResult = requestType.errorSerializer.deserialize(
					response.error.data
				);
				if (deserializationResult.hasErrors) {
					throw new Error(deserializationResult.formatError());
				}
				errorData = deserializationResult.value;
			} else {
				errorData = undefined;
			}

			const error = new RequestHandlingError(
				response.error.message,
				errorData,
				response.error.code
			);
			this.requestDidErrorEventEmitter.emit({ error });
			throw error;
		} else {
			const result = requestType.resultSerializer.deserialize(
				response.result
			);
			if (result.hasErrors) {
				throw new Error(result.formatError());
			} else {
				return result.value;
			}
		}
	}

	public notify<TParams>(
		notificationType: NotificationType<TParams>,
		params: TParams
	): void {
		if (!this.checkChannel(this.channel)) {
			throw "";
		}

		const encodedParams = notificationType.paramsSerializer.serialize(
			params
		);

		assertObjectArrayOrNull(encodedParams);

		this.channel.sendNotification({
			method: notificationType.method,
			params: encodedParams,
		});
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

export type RequestHandlerFunc<TArg, TResult, TError> = (
	arg: TArg,
	requestId: RequestId
) => Promise<Result<TResult, TError>>;

export type NotificationHandlerFunc<TArg> = (arg: TArg) => void;

interface RegisteredRequestHandler<TArg = any, TResult = any, TError = any> {
	readonly kind: "request";
	readonly requestType: RequestType<TArg, TResult, TError>;
	readonly handler: RequestHandlerFunc<TArg, TResult, TError>;
}

interface RegisteredNotificationHandler<TArg = any> {
	readonly kind: "notification";
	readonly notificationType: NotificationType<TArg>;
	readonly handlers: Set<NotificationHandlerFunc<TArg>>;
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
	TMethod extends string | undefined = string
> {
	public readonly kind: "request" = "request";

	constructor(
		public readonly method: TMethod,
		public readonly paramsSerializer: BaseSerializer<TParams>,
		public readonly resultSerializer: BaseSerializer<TResponse>,
		public readonly errorSerializer: BaseSerializer<TError>
	) {}

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
}

/**
 * Describes a notification type.
 */
export class NotificationType<TParams = unknown, TMethod = string> {
	public readonly kind: "notification" = "notification";

	constructor(
		public readonly method: TMethod,
		public readonly paramsSerializer: Serializer<TParams>
	) {}

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
	return new NotificationType(method, sAny());
}

/**
 * Describes a request type as part of a `Contract`.
 */
export function requestType<
	TMethod extends string | undefined = undefined,
	TParams extends Serializer<any> = Serializer<{}>,
	TResult extends Serializer<any> = Serializer<void>,
	TError extends Serializer<any> = Serializer<undefined>
>(request: {
	method?: TMethod;
	params?: TParams;
	result?: TResult;
	error?: TError;
}): RequestType<TParams["T"], TResult["T"], TError["T"], TMethod> {
	return new RequestType(
		request.method!,
		request.params ? request.params : sObject({}),
		request.result ? request.result : sVoidToNull(),
		request.error ? request.error : sVoidToNull()
	);
}

export function sVoidToNull(): Serializer<void> {
	return sNull().refine({
		canSerialize: (val): val is void => val === undefined,
		fromIntermediate: (i) => undefined,
		toIntermediate: (i) => null,
	});
}

/**
 * Describes a notification type as part of a `Contract`.
 */
export function notificationType<
	TMethod extends string | undefined = undefined,
	TParams extends Serializer<any> = Serializer<{}>
>(notification: {
	method?: TMethod;
	params?: TParams;
}): NotificationType<TParams["T"], TMethod> {
	return new NotificationType(
		notification.method!,
		notification.params ? notification.params : sObject({})
	);
}

function setAndDeleteOnDispose<T>(set: Set<T>, item: T): Disposable;
function setAndDeleteOnDispose<TKey, TValue>(
	set: Map<TKey, TValue>,
	key: TKey,
	item: TValue
): Disposable;
function setAndDeleteOnDispose(
	set: Set<any> | Map<any, any>,
	keyOrItem: any,
	item?: any
): Disposable {
	if (set instanceof Set) {
		set.add(keyOrItem);
		return Disposable.create(() => set.delete(keyOrItem));
	} else {
		set.set(keyOrItem, item);
		return Disposable.create(() => set.delete(keyOrItem));
	}
}
