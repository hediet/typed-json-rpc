import { Message } from "./JsonRpcTypes";
import { RpcLogger } from "./Logger";
import { Deferred } from "@hediet/std/synchronization";

/**
 * Represents a bidirectional stream of messages.
 * No messages are lost when delaying reading with `setReadCallback`.
 */
export interface MessageStream {
	/**
	 * Is resolved when the stream closed.
	 */
	onClosed: Promise<void>;

	/**
	 * Writes a message to the stream.
	 */
	write(message: Message): Promise<void>;

	/**
	 * Sets a callback for incoming messages.
	 * Processes all yet unhandled and future incoming messages.
	 */
	setReadCallback(
		callback: ((readMessage: Message) => void) | undefined
	): void;

	/**
	 * Returns human readable information of this message stream.
	 */
	toString(): string;
}

/**
 * Base class for implementing a MessageStream.
 * Provides a unreadMessage queue.
 */
export abstract class BaseMessageStream implements MessageStream {
	private static id = 0;

	private readonly unreadMessages: Message[] = [];
	private onMessageCallback: ((readMessage: Message) => void) | undefined;
	protected readonly id = BaseMessageStream.id++;

	private readonly onClosedDeferred = new Deferred();

	/**
	 * Is resolved when the stream closed.
	 */
	public readonly onClosed = this.onClosedDeferred.promise;

	/**
	 * Sets a callback for incoming messages.
	 */
	public setReadCallback(
		callback: ((readMessage: Message) => void) | undefined
	): void {
		this.onMessageCallback = callback;

		if (!callback) return;

		while (this.unreadMessages.length > 0) {
			const msg = this.unreadMessages.shift()!;
			callback(msg);
		}
	}

	/**
	 * Writes a message to the stream.
	 */
	public abstract write(message: Message): Promise<void>;

	/**
	 * Returns human readable information of this message stream.
	 */
	public abstract toString(): string;

	/**
	 * Call this in derived classes to signal a new message.
	 */
	protected onMessage(message: Message): void {
		const hasReadAllQueuedMessages = this.unreadMessages.length === 0;
		if (hasReadAllQueuedMessages && this.onMessageCallback) {
			this.onMessageCallback(message);
		} else {
			this.unreadMessages.push(message);
		}
	}

	/**
	 * Call this in derived classes to signal that the connection closed.
	 */
	protected onConnectionClosed(): void {
		this.onClosedDeferred.resolve();
	}
}

/**
 * Used by `StreamLogger` to log messages.
 */
export interface MessageLogger {
	log(
		stream: MessageStream,
		type: "incoming" | "outgoing",
		message: Message
	): void;
}

/**
 * Intercepts a stream for logging.
 */
export class StreamLogger implements MessageStream {
	constructor(
		private readonly baseStream: MessageStream,
		private readonly logger: MessageLogger
	) {}

	public get onClosed() {
		return this.baseStream.onClosed;
	}

	public setReadCallback(
		callback: ((readMessage: Message) => void) | undefined
	) {
		if (callback === undefined) {
			this.baseStream.setReadCallback(undefined);
			return;
		}

		this.baseStream.setReadCallback((readMessage) => {
			this.logger.log(this.baseStream, "incoming", readMessage);
			callback(readMessage);
		});
	}

	public write(message: Message): Promise<void> {
		this.logger.log(this.baseStream, "outgoing", message);
		return this.baseStream.write(message);
	}

	public toString(): string {
		return `StreamLogger/${this.baseStream.toString()}`;
	}
}

/**
 * Logs messages to a `RpcLogger`.
 */
export class RpcStreamLogger extends StreamLogger {
	constructor(baseStream: MessageStream, rpcLogger: RpcLogger) {
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
	constructor(baseStream: MessageStream) {
		super(baseStream, {
			log: (stream, type, message) => {
				const char = type === "incoming" ? "<-" : "->";
				console.log(
					`${char} [${stream.toString()}] ${JSON.stringify(message)}`
				);
			},
		});
	}
}
