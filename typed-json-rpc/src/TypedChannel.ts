import * as t from "io-ts";
import { Channel, ChannelFactory, RequestObject, ResponseObject } from "./Channel";
import { RequestId, ErrorCode } from "./JsonRpcTypes";
import { RpcLogger } from "./Logger";

export type RequestHandlerFunc<TArg, TResult, TError> = (arg: TArg) => Promise<{ result: TResult } | { error: TError }>;
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
    private channel: Channel|undefined = undefined;
    private handler = new Map<string, RegisteredRequestHandler | RegisteredNotificationHandler>();

    constructor(private readonly channelCtor: ChannelFactory, private readonly logger: RpcLogger|undefined) {
    }

    /**
     * This method must be called to forward messages from the stream to this channel.
     * This is not done automatically on construction so that this instance can be setup properly before handling messages.
     */
    public startListen(): void {
        if (this.channel) {
            throw new Error("`startListen` can be called only once, but it already has been called.");
        }

        this.channel = this.channelCtor.createChannel({
            handleRequest: (req, id) => this.handleRequest(req, id),
            handleNotification: (req) => this.handleNotification(req),
        });
    }

    private checkChannel(channel: Channel|undefined): channel is Channel {
        if (!channel) {
            throw new Error("`startListen` must be called before any messages can be sent or received.");
        }
        return true;
    }

	private async handleRequest(request: RequestObject, _requestId: RequestId): Promise<ResponseObject> {
        const handler = this.handler.get(request.method);
        if (!handler) {
            if (this.logger) {
                this.logger.debug({
                    text: `No request handler for "${request.method}".`,
                    data: { requestObject: request },
                })
            }

            return Promise.resolve<ResponseObject>({
                error: {
                    code: ErrorCode.methodNotFound,
                    message: `No request handler for "${request.method}".`,
                    data: { method: request.method },
                }
            });
        }

        if (handler.kind != "request") {
            if (this.logger) {
                this.logger.debug({
                    text: `"${request.method}" is registered as notification, but was sent as request.`,
                    data: { requestObject: request },
                })
            }

            return Promise.resolve<ResponseObject>({
                error: {
                    code: ErrorCode.invalidRequest,
                    message: `"${request.method}" is registered as notification, but was sent as request.`,
                    data: { method: request.method },
                }
            }); 
        }

        const decodeResult = handler.requestType.paramType.decode(request.params);
        if (decodeResult.isLeft()) {
            if (this.logger) {
                this.logger.debug({
                    text: `Got invalid params: ${decodeResult.value.map(e => e.message).join(", ")}.`,
                    data: { requestObject: request, errors: decodeResult.value },
                })
            }

            return Promise.resolve<ResponseObject>({
                error: {
                    code: ErrorCode.invalidParams,
                    message: decodeResult.value.map(e => e.message).join(", "),
                    data: { errors: decodeResult.value },
                }
            });
        } else if (decodeResult.isRight()) {
            const args = decodeResult.value;
            let response: ResponseObject;
            try {
                const result = await handler.handler(args);
                if ("error" in result) {
                    // TODO enable the handler to specify error message and error code.
                    const errorData = handler.requestType.errorType.encode(result.error);
                    response = { error: { code: ErrorCode.applicationError(320100), message: "An error was returned", data: errorData } };
                } else {
                    const val = handler.requestType.resultType.encode(result.result);
                    response = { result: val };
                }
            } catch (exception) {
                // TODO check type of `ex`
                if (this.logger) {
                    this.logger.warn({
                        text: `An exception was thrown while handling a request: ${exception.toString()}.`,
                        exception,
                        data: { requestObject: request },
                    })
                }
                
                response = {
                    error: {
                        code: ErrorCode.serverError(-32000),
                        message: "Server has thrown an unexpected exception",
                    }
                };
            }
            return Promise.resolve(response);
        } else {
            throw new Error("Impossible");
        }
    }

	private handleNotification(request: RequestObject): Promise<void> {
        const handler = this.handler.get(request.method);
        if (!handler) {
            return Promise.resolve();
        }

        if (handler.kind != "notification") {
            if (this.logger) {
                this.logger.debug({
                    text: `"${request.method}" is registered as request, but was sent as notification.`,
                    data: { requestObject: request },
                })
            }

            // dont send a response back as we are handling a notification.
            return Promise.resolve();
        }

        const decodeResult = handler.notificationType.paramType.decode(request.params);
        if (decodeResult.isLeft()) {
            if (this.logger) {
                this.logger.debug({
                    text: `Got invalid params: ${decodeResult.value.map(e => e.message).join(", ")}.`,
                    data: { requestObject: request, errors: decodeResult.value },
                })
            }

            // dont send a response back as we are handling a notification.
            return Promise.resolve();
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
                    })
                }
            }
        }

        return Promise.resolve();
    }

    public registerRequestHandler<TArgs, TResponse, TError>(requestType: RequestType<TArgs, TResponse, TError>, handler: RequestHandlerFunc<TArgs, TResponse, TError>) {
        const registeredHandler = this.handler.get(requestType.method);
        if (registeredHandler) {
            throw new Error(`Handler with method "${requestType.method}" already registered.`);
        }

        this.handler.set(requestType.method, { kind: "request", requestType, handler });
    }

    public registerNotificationHandler<TArgs>(type: NotificationType<TArgs>, handler: NotificationHandlerFunc<TArgs>): void {
        let registeredHandler = this.handler.get(type.method);
        if (!registeredHandler) {
            registeredHandler = { kind: "notification", notificationType: type, handlers: [] };
            this.handler.set(type.method, registeredHandler);
        } else {
            if (registeredHandler.kind !== "notification") {
                throw new Error(`Method "${type.method}" was already registered as request handler.`);
            }
            if (registeredHandler.notificationType !== type) {
                throw new Error(`Method "${type.method}" was registered for a different type.`);
            }
        }

        registeredHandler.handlers.push(handler);
    }

    public async request<TParams, TResponse>(requestType: RequestType<TParams, TResponse, unknown>, args: TParams): Promise<TResponse> {
        if (!this.checkChannel(this.channel)) { throw ""; }

        let params = requestType.paramType.encode(args);

        const response = await this.channel.sendRequest({ method: requestType.method, params });

        if ("error" in response) {
            // TODO custom error
            const e = new Error(response.error.message);
            (e as any).code = response.error.code;
            (e as any).data = response.error.data;
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

    public notify<TParams>(notificationType: NotificationType<TParams>, args: TParams): void {
        if (!this.checkChannel(this.channel)) { throw ""; }

        let params = notificationType.paramType.encode(args);
        this.channel.sendNotification({ method: notificationType.method, params });
    }

    /*public requestAndCatchError(connection: Connection, body: TRequest): Promise<Result<TResponse, TError>> {

    }*/
}

export class RequestType<TArgs = unknown, TResponse = unknown, TError = unknown> {
    public readonly kind: "request" = "request";

    constructor(
        public readonly method: string,
        public readonly paramType: t.Type<TArgs>,
        public readonly resultType: t.Type<TResponse>,
        public readonly errorType: t.Type<TError>,
    ) {
    }
}

export class NotificationType<TParams = unknown> {
    public readonly kind: "notification" = "notification";
    
    constructor(
        public readonly method: string,
        public readonly paramType: t.Type<TParams>,
    ) {
    }
}

/*
function request<TRequest extends t.Props, TResponse, TError>(name: string, request: TRequest, response: t.Type<TResponse>): RequestType<t.TypeC<TRequest>["_A"], TResponse, TError> {
    return new RequestType<TRequest, TResponse, TError>(name, t.type<TRequest>(request), response, t.void);
}

function notification<TRequest extends t.Props, TError>(name: string, request: TRequest): NotificationType<t.TypeC<TRequest>["_A"]> {

}
*/
