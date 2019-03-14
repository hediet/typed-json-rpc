import { Message, BaseMessageStream } from "@hediet/typed-json-rpc";
import { ChildProcess } from "child_process";

export class NodeJsMessageStream extends BaseMessageStream {
	public static connectToThisProcess(): NodeJsMessageStream {
		return new NodeJsMessageStream(process.stdout, process.stdin);
	}

	public static connectToProcess(process: ChildProcess): NodeJsMessageStream {
		return new NodeJsMessageStream(process.stdin!, process.stdout!);
	}

	constructor(
		private readonly writeStream: NodeJS.WritableStream,
		private readonly readStream: NodeJS.ReadableStream
	) {
		super();

		let closed = false;

		readStream.on("data", (chunk: any) => {
			const str = chunk.toString("utf8");
			const parts = str.trim().split("\n"); // todo improve
			for (const p of parts) {
				const obj = JSON.parse(p) as Message;
				this.onMessage(obj);
			}
		});

		readStream.on("close", () => {
			if (!closed) {
				closed = true;
				this.onConnectionClosed();
			}
		});

		writeStream.on("close", () => {
			if (!closed) {
				closed = true;
				this.onConnectionClosed();
			}
		});
	}

	public close(): void {
		this.writeStream.end();
	}

	public dispose(): void {
		this.close();
	}

	public write(message: Message): Promise<void> {
		const str = JSON.stringify(message);

		return new Promise((res, rej) => {
			this.writeStream.write(str + "\n", err => {
				if (err) {
					rej(err);
				} else {
					res();
				}
			});
		});
	}

	public toString(): string {
		return `${this.id}@stream`;
	}
}
