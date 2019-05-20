import { Message, BaseMessageStream } from "@hediet/typed-json-rpc";
import { ChildProcess } from "child_process";

/**
 * Wraps a write and read stream.
 */
export class NodeJsMessageStream extends BaseMessageStream {
	/**
	 * Gets a stream that uses `process.stdout` for writing
	 * and `process.stdin` for reading.
	 */
	public static connectToThisProcess(): NodeJsMessageStream {
		return new NodeJsMessageStream(process.stdout, process.stdin);
	}

	/**
	 * Gets a stream that uses `process.stdin` for writing
	 * and `process.stdout` for reading of the given process `process`.
	 */
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

	/**
	 * Closes the write stream.
	 */
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
