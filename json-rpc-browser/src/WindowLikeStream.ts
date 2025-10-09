import { BaseMessageTransport, Message } from "@hediet/json-rpc";

export interface WindowLike {
	postMessage(data: any, ...misc: any[]): void;
	addEventListener(eventName: "message", handler: MessageEventListener): void;
	removeEventListener(eventName: "message", handler: MessageEventListener): void;
}

export type MessageEventListener = (ev: { data: any; source: WindowLike | undefined }) => void;

export class WindowLikeTransport extends BaseMessageTransport {
	private _disposed = false;

	constructor(
		private readonly _windowLike: WindowLike,
		private readonly _source: WindowLike | undefined = undefined,
		private readonly _loadingState:
			| { loaded: boolean; onLoaded: Promise<void> }
			| undefined = undefined
	) {
		super();

		this._windowLike.addEventListener("message", this._messageHandler);
	}

	private readonly _messageHandler: MessageEventListener = ({ data, source }) => {
		if (this._source && source !== this._source) {
			return;
		}
		if (typeof data === "object" && data) {
			this._dispatchReceivedMessage(data);
		}
	};

	protected override async _sendImpl(message: Message): Promise<void> {
		if (this._disposed) {
			throw new Error("Transport is disposed");
		}
		if (this._loadingState && !this._loadingState.loaded) {
			await this._loadingState.onLoaded;
		}
		this._windowLike.postMessage(message);
	}

	public toString(): string {
		return `${this.id}@${this._windowLike}`;
	}

	public dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;
		this._windowLike.removeEventListener("message", this._messageHandler);
	}
}
