import {
    Message,
    isRequestOrNotification,
    ResponseMessage,
    RequestMessage,
    ErrorCode,
    RequestId
} from "./JsonRpcTypes";
import {
    Channel,
    RequestHandler,
    ResponseObject,
    RequestObject,
    ChannelFactory
} from "./Channel";
import { MessageStream } from "./MessageStream";
import { RpcLogger } from "./Logger";

/**
 * Implements a channel through a stream and an optional request handler to handle incoming requests.
 */
export class StreamBasedChannel implements Channel {
    public static getFactory(
        stream: MessageStream,
        logger: RpcLogger | undefined
    ): ChannelFactory {
        let constructed = false;
        return {
            createChannel: listener => {
                if (constructed) {
                    throw new Error(
                        `A channel to the stream ${stream} was already constructed!`
                    );
                } else {
                    constructed = true;
                }
                return new StreamBasedChannel(stream, listener, logger);
            }
        };
    }

    private readonly unprocessedResponses = new Map<
        string,
        (response: ResponseMessage) => void
    >();
    private requestId = 0;

    constructor(
        private readonly stream: MessageStream,
        private readonly listener: RequestHandler | undefined,
        private readonly logger: RpcLogger | undefined
    ) {
        this.stream.setReadCallback(message => {
            if (isRequestOrNotification(message)) {
                this.processRequestOrNotification(message);
            } else {
                this.processResponse(message);
            }
        });
    }

    private async processRequestOrNotification(message: RequestMessage) {
        if (message.id === undefined) {
            if (!this.listener) {
                if (this.logger) {
                    this.logger.debug({
                        text: "Notification ignored",
                        message
                    });
                }
                return;
            }

            try {
                await this.listener.handleNotification(message);
            } catch (exception) {
                if (this.logger) {
                    this.logger.warn({
                        text: `Exception was thrown while handling notification: ${exception.toString()}`,
                        exception,
                        message
                    });
                }
            }
        } else {
            let result: ResponseObject;
            if (this.listener) {
                try {
                    result = await this.listener.handleRequest(
                        message,
                        message.id
                    );
                } catch (exception) {
                    if (this.logger) {
                        this.logger.warn({
                            text: `Exception was thrown while handling request: ${exception.toString()}`,
                            message,
                            exception
                        });
                    }
                    // do not leak exception details to client as it could contain sensitive information.
                    result = {
                        error: {
                            code: ErrorCode.internalError,
                            message: "An unexpected exception was thrown.",
                            data: undefined
                        }
                    };
                }
            } else {
                if (this.logger) {
                    this.logger.debug({
                        text:
                            "Received request even though not listening for requests",
                        message
                    });
                }
                result = {
                    error: {
                        code: ErrorCode.methodNotFound,
                        message:
                            "This endpoint does not listen for requests or notifications.",
                        data: undefined
                    }
                };
            }
            let responseMsg: ResponseMessage;
            if ("result" in result) {
                responseMsg = { id: message.id, result: result.result };
            } else {
                responseMsg = { id: message.id, error: result.error };
            }
            await this.stream.write(responseMsg);
        }
    }

    private processResponse(message: ResponseMessage) {
        const callback = this.unprocessedResponses.get("" + message.id);
        if (!callback) {
            if (this.logger) {
                this.logger.debug({
                    text: "Got an unexpected response message",
                    message
                });
            }
            return;
        }
        this.unprocessedResponses.delete("" + message.id);
        callback(message);
    }

    private newRequestId(): RequestId {
        return this.requestId++;
    }

    public sendRequest(
        request: RequestObject,
        messageIdCallback?: (requestId: RequestId) => void
    ): Promise<ResponseObject> {
        const msg = {
            id: this.newRequestId(),
            method: request.method,
            params: request.params
        };

        if (messageIdCallback) {
            messageIdCallback(msg.id!);
        }

        return new Promise<ResponseObject>((resolve, reject) => {
            this.unprocessedResponses.set("" + msg.id, response => {
                if ("result" in response) {
                    resolve({ result: response.result! });
                } else {
                    if (!response.error) {
                        /*if (this.logger) {
                            this.logger.debug({
                                text: "Response had neither 'result' nor 'error' field set.",
                                message: response
                            });
                        }*/
                        // we could also resolve here, setting our own error
                        reject(
                            new Error(
                                "Response had neither 'result' nor 'error' field set."
                            )
                        );
                    }
                    resolve({ error: response.error! });
                }
            });

            this.stream.write(msg).then(undefined, reason => {
                this.unprocessedResponses.delete("" + msg.id);
                reject(reason);
            });
        });
    }

    public sendNotification(notification: RequestObject): Promise<void> {
        const msg: Message = {
            id: undefined,
            method: notification.method,
            params: notification.params
        };
        return this.stream.write(msg);
    }

    public toString(): string {
        return "StreamChannel/" + this.stream.toString();
    }
}
