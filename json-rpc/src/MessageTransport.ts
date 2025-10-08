import { IValueWithChangeEvent, ValueWithChangeEvent } from "./common";
import { Message } from "./JsonRpcTypes";
import { RpcLogger } from "./Logger";

/**
 * Represents a mechanism to send and receive messages.
 */
export interface IMessageTransport {

	get state(): IValueWithChangeEvent<ConnectionState>;

	send(message: Message): Promise<void>;

	/**
	 * Sets a listener for received messages.
	 * The listener might be called multiple times before this function returns.
	 * The method allows reentrancy.
	 */
	setListener(listener: MessageListener | undefined): void;

	/**
	 * Returns a human readable representation of this stream.
	 */
	toString(): string;
}

export type ConnectionState = { state: "connecting" } | { state: "open" } | { state: "closed", error: Error | undefined };

export type MessageListener = (message: Message) => void;

/**
 * Base class for implementing a MessageStream.
 * Provides an unreadMessage queue.
 */
export abstract class BaseMessageTransport implements IMessageTransport {
	private static id = 0;

	private readonly _unprocessedMessages: Message[] = [];
	private _messageListener: MessageListener | undefined;
	protected readonly id = BaseMessageTransport.id++;

	private readonly _state = new ValueWithChangeEvent<ConnectionState>({ state: "open" });
	public readonly state = this._state;

	/**
	 * Sets a callback for incoming messages.
	 */
	public setListener(listener: MessageListener | undefined): void {
		this._messageListener = listener;

		if (!listener) {
			return;
		}

		// _messageListener might change!
		while (this._unprocessedMessages.length > 0 && this._messageListener !== undefined) {
			const msg = this._unprocessedMessages.shift()!;
			this._messageListener(msg);
		}
	}

	/**
	 * Writes a message to the stream.
	 */
	public send(message: Message): Promise<void> {
		return this._sendImpl(message);
	}

	protected abstract _sendImpl(message: Message): Promise<void>;

	/**
	 * Returns human readable information of this message stream.
	 */
	public abstract toString(): string;

	/**
	 * Call this in derived classes to signal a new message.
	 */
	protected _dispatchReceivedMessage(message: Message): void {
		const hasReadAllQueuedMessages = this._unprocessedMessages.length === 0;
		if (hasReadAllQueuedMessages && this._messageListener) {
			this._messageListener(message);
		} else {
			this._unprocessedMessages.push(message);
		}
	}

	/**
	 * Call this in derived classes to signal that the connection closed.
	 */
	protected _onConnectionClosed(): void {
		this._state.value = { state: 'closed', error: undefined };
	}

	public log(logger?: IMessageLogger): IMessageTransport {
		return new StreamLogger(this, logger ?? new ConsoleMessageLogger());
	}
}

/**
 * Used by `StreamLogger` to log messages.
 */
export interface IMessageLogger {
	log(stream: IMessageTransport, type: "incoming" | "outgoing", message: Message): void;
}

/**
 * Intercepts a stream for logging.
 */
export class StreamLogger implements IMessageTransport {
	constructor(
		private readonly baseStream: IMessageTransport,
		private readonly logger: IMessageLogger
	) { }

	public get state(): IValueWithChangeEvent<ConnectionState> {
		return this.baseStream.state;
	}

	public setListener(listener: ((readMessage: Message) => void) | undefined) {
		if (listener === undefined) {
			this.baseStream.setListener(undefined);
			return;
		}

		this.baseStream.setListener((readMessage) => {
			this.logger.log(this.baseStream, "incoming", readMessage);
			listener(readMessage);
		});
	}

	public send(message: Message): Promise<void> {
		this.logger.log(this.baseStream, "outgoing", message);
		return this.baseStream.send(message);
	}

	public toString(): string {
		return `StreamLogger/${this.baseStream.toString()}`;
	}
}

/**
 * Logs messages to a `RpcLogger`.
 */
export class RpcStreamLogger extends StreamLogger {
	constructor(baseStream: IMessageTransport, rpcLogger: RpcLogger) {
		super(baseStream, {
			log: (stream, type, message) => {
				const char = type === "incoming" ? "<-" : "->";
				rpcLogger.trace({
					text: `${char} [${stream.toString()}] ${JSON.stringify(
						message
					)}`,
					message: message,
				});
			},
		});
	}
}

/**
 * Logs messages to `console`.
 */
export class ConsoleStreamLogger extends StreamLogger {
	constructor(baseStream: IMessageTransport) {
		super(baseStream, new ConsoleMessageLogger());
	}
}

export class ConsoleMessageLogger implements IMessageLogger {
	log(stream: IMessageTransport, type: "incoming" | "outgoing", message: Message): void {
		const char = type === "incoming" ? "<-" : "->";
		console.log(`${char} [${stream.toString()}] ${JSON.stringify(message)}`);
	}
}
