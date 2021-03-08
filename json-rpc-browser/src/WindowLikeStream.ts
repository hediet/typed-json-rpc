import { BaseMessageStream, Message } from "@hediet/json-rpc";

export interface WindowLike {
	postMessage(data: any, ...misc: any[]): void;
	addEventListener(
		ev: "message",
		handler: (ev: { data: any; source: WindowLike | undefined }) => void
	): void;
}

export class WindowLikeStream extends BaseMessageStream {
	constructor(
		private readonly windowLike: WindowLike,
		private readonly source: WindowLike | undefined = undefined,
		private readonly loadingState:
			| { loaded: boolean; onLoaded: Promise<void> }
			| undefined = undefined
	) {
		super();

		windowLike.addEventListener("message", ({ data, source }) => {
			if (this.source && source !== this.source) {
				return;
			}
			if ("rpcMsg" in data) {
				this.onMessage(data.rpcMsg);
			}
		});
	}

	public async write(message: Message): Promise<void> {
		if (this.loadingState && !this.loadingState.loaded) {
			await this.loadingState.onLoaded;
		}
		this.windowLike.postMessage({ rpcMsg: message }, "*");
	}

	public toString(): string {
		return `${this.id}@${this.windowLike}`;
	}
}
