import { Channel, IRequestHandler, IRequestSender, RequestObject, ResponseObject } from "./Channel";
import { ErrorCode, IRequestMessage, IResponseMessage, Message, RequestId, isRequestOrNotification } from "./JsonRpcTypes";
import { RpcLogger } from "./Logger";
import { ConnectionState, IMessageTransport } from "./MessageTransport";
import { IValueWithChangeEvent } from "./common";

/**
 * Implements a channel through a stream and an optional request handler to handle incoming requests.
 */
export class StreamBasedChannel implements IRequestSender {
	/**
	 * Creates a channel factory from a given stream and logger.
	 * This allows to delay specifying a `RequestHandler`.
	 * Once the channel is created, it processes incoming messages.
	 */
	public static createChannel(stream: IMessageTransport, logger: RpcLogger | undefined): Channel {
		let constructed = false;
		return new Channel((listener) => {
			if (constructed) {
				throw new Error(
					`A channel to the stream ${stream} was already constructed!`
				);
			} else {
				constructed = true;
			}
			return new StreamBasedChannel(stream, listener, logger);
		});
	}

	private readonly _unprocessedResponses = new Map<string, (response: IResponseMessage) => void>();
	private _lastUsedRequestId = 0;

	constructor(
		private readonly _stream: IMessageTransport,
		private readonly _listener: IRequestHandler | undefined,
		private readonly _logger: RpcLogger | undefined
	) {
		this._stream.setListener((message) => {
			if (isRequestOrNotification(message)) {
				if (message.id === undefined) {
					this._processNotification(message);
				} else {
					this._processRequest(message);
				}
			} else {
				this._processResponse(message);
			}
		});
	}

	get state(): IValueWithChangeEvent<ConnectionState> {
		return this._stream.state;
	}

	private async _processNotification(message: IRequestMessage): Promise<void> {
		if (message.id !== undefined) { throw new Error(); }

		if (!this._listener) {
			if (this._logger) {
				this._logger.debug({
					text: "Notification ignored",
					message,
				});
			}
			return;
		}

		try {
			await this._listener.handleNotification({
				method: message.method,
				params: message.params || null,
			});
		} catch (exception) {
			if (this._logger) {
				this._logger.warn({
					text: `Exception was thrown while handling notification: ${exception}`,
					exception,
					message,
				});
			}
		}
	}

	private async _processRequest(message: IRequestMessage): Promise<void> {
		if (message.id === undefined) { throw new Error(); }

		let result: ResponseObject;
		if (this._listener) {
			try {
				result = await this._listener.handleRequest(
					{
						method: message.method,
						params: message.params || null,
					},
					message.id
				);
			} catch (exception) {
				if (this._logger) {
					this._logger.warn({
						text: `Exception was thrown while handling request: ${exception}`,
						message,
						exception,
					});
				}
				// do not leak exception details to client as it could contain sensitive information.
				result = {
					error: {
						code: ErrorCode.internalError,
						message: "An unexpected exception was thrown.",
						data: undefined,
					},
				};
			}
		} else {
			if (this._logger) {
				this._logger.debug({
					text:
						"Received request even though not listening for requests",
					message,
				});
			}
			result = {
				error: {
					code: ErrorCode.methodNotFound,
					message:
						"This endpoint does not listen for requests or notifications.",
					data: undefined,
				},
			};
		}
		let responseMsg: IResponseMessage;
		if ("result" in result) {
			responseMsg = {
				jsonrpc: "2.0",
				id: message.id,
				result: result.result,
			};
		} else {
			responseMsg = {
				jsonrpc: "2.0",
				id: message.id,
				error: result.error,
			};
		}
		await this._stream.send(responseMsg);

	}

	private _processResponse(message: IResponseMessage): void {
		const strId = "" + message.id;
		const callback = this._unprocessedResponses.get(strId);
		if (!callback) {
			if (this._logger) {
				this._logger.debug({
					text: "Got an unexpected response message",
					message,
				});
			}
			return;
		}
		this._unprocessedResponses.delete(strId);
		callback(message);
	}

	private _newRequestId(): RequestId {
		return this._lastUsedRequestId++;
	}

	public sendRequest(request: RequestObject, _context: void, messageIdCallback?: (requestId: RequestId) => void): Promise<ResponseObject> {
		const message: Message = {
			jsonrpc: "2.0",
			id: this._newRequestId(),
			method: request.method,
			params: request.params || undefined,
		};

		if (messageIdCallback) {
			messageIdCallback(message.id!);
		}

		return new Promise<ResponseObject>((resolve, reject) => {
			const strId = "" + message.id;
			this._unprocessedResponses.set(strId, (response) => {
				if ("result" in response) {
					resolve({ result: response.result! });
				} else {
					if (!response.error) {
						reject(
							new Error(
								"Response had neither 'result' nor 'error' field set."
							)
						);
					}
					resolve({ error: response.error! });
				}
			});

			this._stream.send(message).then(undefined, (reason) => {
				// Assuming no response will ever be sent as sending failed.
				this._unprocessedResponses.delete(strId);
				reject(reason);
			});
		});
	}

	public sendNotification(notification: RequestObject, context: void): Promise<void> {
		const msg: Message = {
			jsonrpc: "2.0",
			id: undefined,
			method: notification.method,
			params: notification.params || undefined,
		};
		return this._stream.send(msg);
	}

	public toString(): string {
		return "StreamChannel/" + this._stream.toString();
	}
}
