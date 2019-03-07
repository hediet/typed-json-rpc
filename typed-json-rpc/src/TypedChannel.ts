import * as t from "io-ts";
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
import { StreamBasedChannel, MessageStream } from ".";

export type RuntimeJsonType<T> = t.Type<T, JSONValue, unknown>;
export type RuntimeJsonTypeArrOrObj<T> = t.Type<
	T,
	JSONObject | JSONArray,
	unknown
>;

export type Result<TOk, TError> = OkResult<TOk> | ErrorResult<TError>;

export interface OkResult<TOk> {
	ok: TOk;
}

export interface ErrorResult<TError> {
	error: TError;
	errorMessage?: string;
	errorCode?: ErrorCode;
}

export type RequestHandlerFunc<TArg, TResult, TError> = (
	arg: TArg
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
	readonly handlers: NotificationHandlerFunc<TArg>[];
}

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
	private readonly unknownNotificationHandler: ((
		notification: RequestObject
	) => void)[] = [];
	private timeoutHandle: any;

	constructor(
		private readonly channelCtor: ChannelFactory,
		private readonly logger: RpcLogger | undefined
	) {
		if (process.env.NODE_ENV !== "production") {
			this.timeoutHandle = setTimeout(() => {
				if (!this.channel) {
					console.warn(
						`"${
							this.startListen.name
						}" has not been called within 1 second after construction of this channel. Did you forget to call it?`,
						this
					);
				}
			}, 1000);
		}
	}

	/**
	 * This method must be called to forward messages from the stream to this channel.
	 * This is not done automatically on construction so that this instance can be setup properly before handling messages.
	 */
	public startListen(): void {
		if (this.channel) {
			throw new Error(
				`"${
					this.startListen.name
				}" can be called only once, but it already has been called.`
			);
		}
		if (this.timeoutHandle) {
			clearInterval(this.timeoutHandle);
			this.timeoutHandle = undefined;
		}
		this.channel = this.channelCtor.createChannel({
			handleRequest: (req, id) => this.handleRequest(req, id),
			handleNotification: req => this.handleNotification(req),
		});
	}

	private checkChannel(channel: Channel | undefined): channel is Channel {
		if (!channel) {
			throw new Error(
				`"${
					this.startListen.name
				}" must be called before any messages can be sent or received.`
			);
		}
		return true;
	}

	private async handleRequest(
		request: RequestObject,
		_requestId: RequestId
	): Promise<ResponseObject> {
		const handler = this.handler.get(request.method);
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
			if (this.logger) {
				this.logger.debug({
					text: `"${
						request.method
					}" is registered as notification, but was sent as request.`,
					data: { requestObject: request },
				});
			}

			return {
				error: {
					code: ErrorCode.invalidRequest,
					message: `"${
						request.method
					}" is registered as notification, but was sent as request.`,
					data: { method: request.method },
				},
			};
		}

		const decodeResult = handler.requestType.paramType.decode(
			request.params
		);
		if (decodeResult.isLeft()) {
			if (this.logger) {
				this.logger.debug({
					text: `Got invalid params: ${decodeResult.value
						.map(e => e.message)
						.join(", ")}.`,
					data: {
						requestObject: request,
						errors: decodeResult.value,
					},
				});
			}

			return {
				error: {
					code: ErrorCode.invalidParams,
					message: decodeResult.value.map(e => e.message).join(", "),
					data: {
						errors: decodeResult.value.map(e => e.message || null),
					},
				},
			};
		} else if (decodeResult.isRight()) {
			const args = decodeResult.value;
			let response: ResponseObject;
			try {
				const result = await handler.handler(args);
				if ("error" in result) {
					const errorData = handler.requestType.errorType.encode(
						result.error
					);
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
					const val = handler.requestType.resultType.encode(
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
						message: "Server has thrown an unexpected exception",
					},
				};
			}
			return response;
		} else {
			throw new Error("Impossible");
		}
	}

	private async handleNotification(request: RequestObject): Promise<void> {
		const handler = this.handler.get(request.method);
		if (!handler) {
			for (const h of this.unknownNotificationHandler) {
				h(request);
			}
			if (this.unknownNotificationHandler.length === 0) {
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
					text: `"${
						request.method
					}" is registered as request, but was sent as notification.`,
					data: { requestObject: request },
				});
			}

			// dont send a response back as we are handling a notification.
			return;
		}

		const decodeResult = handler.notificationType.paramType.decode(
			request.params
		);
		if (decodeResult.isLeft()) {
			if (this.logger) {
				this.logger.debug({
					text: `Got invalid params: ${decodeResult.value
						.map(e => e.message)
						.join(", ")}.`,
					data: {
						requestObject: request,
						errors: decodeResult.value,
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
	): void {
		this.unknownNotificationHandler.push(handler);
	}

	public registerRequestHandler<TArgs, TResponse, TError>(
		requestType: RequestType<TArgs, TResponse, TError>,
		handler: RequestHandlerFunc<TArgs, TResponse, TError>
	) {
		const registeredHandler = this.handler.get(requestType.method);
		if (registeredHandler) {
			throw new Error(
				`Handler with method "${
					requestType.method
				}" already registered.`
			);
		}

		this.handler.set(requestType.method, {
			kind: "request",
			requestType,
			handler,
		});
	}

	public registerNotificationHandler<TArgs>(
		type: NotificationType<TArgs>,
		handler: NotificationHandlerFunc<TArgs>
	): void {
		let registeredHandler = this.handler.get(type.method);
		if (!registeredHandler) {
			registeredHandler = {
				kind: "notification",
				notificationType: type,
				handlers: [],
			};
			this.handler.set(type.method, registeredHandler);
		} else {
			if (registeredHandler.kind !== "notification") {
				throw new Error(
					`Method "${
						type.method
					}" was already registered as request handler.`
				);
			}
			if (registeredHandler.notificationType !== type) {
				throw new Error(
					`Method "${
						type.method
					}" was registered for a different type.`
				);
			}
		}

		registeredHandler.handlers.push(handler);
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

		let params = requestType.paramType.encode(args);

		const response = await this.channel.sendRequest({
			method: requestType.method,
			params,
		});

		if ("error" in response) {
			const e = new RequestHandlingError(
				response.error.message,
				response.error.data,
				response.error.code
			);
			throw e;
		} else {
			const result = requestType.resultType.decode(response.result);
			if (result.isLeft()) {
				throw new Error(result.value.map(e => e.message).join(", "));
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

		let encodedParams = notificationType.paramType.encode(params);
		this.channel.sendNotification({
			method: notificationType.method,
			params: encodedParams,
		});
	}

	/*public requestAndCatchError(connection: Connection, body: TRequest): Promise<Result<TResponse, TError>> {

    }*/
}

export class RequestHandlingError<T = any> extends Error {
	constructor(
		message: string,
		public readonly data: T,
		public readonly code: ErrorCode = ErrorCode.genericApplicationError
	) {
		super(message);
		Object.setPrototypeOf(this, RequestHandlingError.prototype);
	}
}

export class RequestType<
	TArgs = unknown,
	TResponse = unknown,
	TError = unknown
> {
	public readonly kind: "request" = "request";

	constructor(
		public readonly method: string,
		public readonly paramType: RuntimeJsonTypeArrOrObj<TArgs>,
		public readonly resultType: RuntimeJsonType<TResponse>,
		public readonly errorType: RuntimeJsonType<TError>
	) {}
}

export class NotificationType<TParams = unknown> {
	public readonly kind: "notification" = "notification";

	constructor(
		public readonly method: string,
		public readonly paramType: RuntimeJsonTypeArrOrObj<TParams>
	) {}
}

export interface Props {
	[key: string]: RuntimeJsonType<any>;
}

export interface CouldNotInfer {
	__unsetMarker: "Unset-Marker";
}

export type CouldNotBeInferred<T, TTrue, TFalse> = CouldNotInfer extends T
	? TTrue
	: TFalse;
export type AsType<T, T2> = T extends T2 ? T : never;

export const voidType = new t.Type<void, JSONValue, JSONValue>(
	"void",
	(u: unknown): u is void => u === undefined,
	(i: unknown, context: t.Context) => {
		if (i === null) {
			return t.success(undefined);
		}
		return t.failure(i, context, "Given value is not 'null'.");
	},
	(_u: void) => null
);

export function request<
	TRequest extends CouldNotInfer | Props,
	TResponse extends CouldNotInfer | RuntimeJsonType<any>,
	TError extends CouldNotInfer | RuntimeJsonType<any>
>(
	method: string,
	request: { params?: TRequest; result?: TResponse; error?: TError }
): RequestType<
	CouldNotBeInferred<TRequest, {}, t.TypeC<AsType<TRequest, t.Props>>["_A"]>,
	CouldNotBeInferred<
		TResponse,
		void,
		AsType<TResponse, RuntimeJsonType<any>>["_A"]
	>,
	CouldNotBeInferred<TError, void, AsType<TError, RuntimeJsonType<any>>["_A"]>
> {
	return {
		kind: "request",
		method: method,
		paramType: (request.params
			? t.type(request.params as t.Props)
			: t.type({})) as any,
		errorType: (request.error ? request.error : voidType) as any,
		resultType: (request.result ? request.result : voidType) as any,
	};
}

export function rawNotification(
	method: string
): NotificationType<JSONObject | JSONArray | undefined> {
	return new NotificationType(method, t.any);
}

export function notification<TRequest extends CouldNotInfer | t.Props>(
	method: string,
	notification: { params?: TRequest }
): NotificationType<
	CouldNotBeInferred<TRequest, {}, t.TypeC<AsType<TRequest, t.Props>>["_A"]>
> {
	return {
		kind: "notification",
		method: method,
		paramType: (notification.params
			? t.type(notification.params as t.Props)
			: t.type({})) as any,
	};
}
