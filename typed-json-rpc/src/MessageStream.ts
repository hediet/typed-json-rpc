import { Message, } from './JsonRpcTypes';

/**
 * No messages are lost when delaying reading with `read` or `setReadCallback`.
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
	 */
	setReadCallback(callback: ((readMessage: Message) => void)|undefined): void;

	/**
	 * Returns human readable information of this message stream.
	 */
	toString(): string;
}

export abstract class BaseMessageStream implements MessageStream {
	private readonly unreadMessages: Message[] = [];
    private onMessageCallback: ((readMessage: Message) => void)|undefined;
    
    /**
     * Call this in derived classes to signal that the connection closed.
     */
    protected readonly onConnectionClosed: () => void;

    /**
     * Call this in derived classes to signal a new message.
     */
	protected onMessage(message: Message) {
		const hasReadAllQueuedMessages = this.unreadMessages.length === 0;
		if (hasReadAllQueuedMessages && this.onMessageCallback)
			this.onMessageCallback(message);
		else
			this.unreadMessages.push(message);
	}

	public abstract write(message: Message): Promise<void>;

	public abstract toString(): string;

    constructor() {
        let onConnectionClosed: () => void;
        this.onClosed = new Promise<void>(resolve => onConnectionClosed = resolve);
        this.onConnectionClosed = onConnectionClosed!;
    }

	public readonly onClosed: Promise<void>;

	public setReadCallback(callback: ((readMessage: Message) => void)|undefined) {
		this.onMessageCallback = callback;
		
		if (!callback) return;

        while (this.unreadMessages.length > 0) {
            const msg = this.unreadMessages.shift()!;
            callback(msg);
        }
    }
}

export class StreamLogger implements MessageStream {
	constructor(private readonly baseStream: MessageStream) {}

	public get onClosed() { return this.baseStream.onClosed; }

	public setReadCallback(callback: ((readMessage: Message) => void)|undefined) {
		if (callback === undefined) {
			this.baseStream.setReadCallback(undefined);
			return;
		}

		this.baseStream.setReadCallback((readMessage) => {
			console.log("< " + JSON.stringify(readMessage));
			callback(readMessage);
		});
	}

	public write(message: Message): Promise<void> {
		console.log("> " + JSON.stringify(message));
		return this.baseStream.write(message);
	}

	public toString(): string {
		return `StreamLogger/${this.baseStream.toString()}`;
	}
}
