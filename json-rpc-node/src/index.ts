import { Message, BaseMessageStream } from "@hediet/json-rpc";
import { ChildProcess } from "child_process";
export * from "@hediet/json-rpc";

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

	private buffer: string = "";

	constructor(
		private readonly _writeStream: NodeJS.WritableStream,
		private readonly _readStream: NodeJS.ReadableStream,
	) {
		super();

		let closed = false;

		this._readStream.on("data", (chunk: any) => {
			const str = chunk.toString("utf8");
			this.buffer += str;

			// Process complete messages (terminated by newlines)
			let newlineIndex: number;
			while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
				const messageStr = this.buffer.substring(0, newlineIndex).trim();
				this.buffer = this.buffer.substring(newlineIndex + 1);

				if (messageStr.length > 0) {
					try {
						const obj = JSON.parse(messageStr) as Message;
						this._onMessage(obj);
					} catch (error) {
						console.error(`Failed to parse JSON message: ${messageStr}`, error);
					}
				}
			}
		});

		this._readStream.on("close", () => {
			if (!closed) {
				closed = true;
				this._onConnectionClosed();
			}
		});

		this._writeStream.on("close", () => {
			if (!closed) {
				closed = true;
				this._onConnectionClosed();
			}
		});
	}

	/**
	 * Closes the write stream.
	 */
	public close(): void {
		this._writeStream.end();
	}

	public dispose(): void {
		this.close();
	}

	public write(message: Message): Promise<void> {
		const str = JSON.stringify(message);

		return new Promise((res, rej) => {
			this._writeStream.write(str + "\n", err => {
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



/**
 * Wraps a write and read stream.
 */
export class NodeJsMessageStreamWithHeaders extends BaseMessageStream {
	/**
	 * Gets a stream that uses `process.stdout` for writing
	 * and `process.stdin` for reading.
	 */
	public static connectToThisProcess(): NodeJsMessageStreamWithHeaders {
		return new NodeJsMessageStreamWithHeaders(process.stdout, process.stdin);
	}

	/**
	 * Gets a stream that uses `process.stdin` for writing
	 * and `process.stdout` for reading of the given process `process`.
	 */
	public static connectToProcess(process: ChildProcess): NodeJsMessageStreamWithHeaders {
		return new NodeJsMessageStreamWithHeaders(process.stdin!, process.stdout!);
	}

	private buffer: Uint8Array = new Uint8Array(0);
	private nextMessageLength: number = -1;

	constructor(
		private readonly _writeStream: NodeJS.WritableStream,
		private readonly _readStream: NodeJS.ReadableStream,
	) {
		super();

		let closed = false;

		this._readStream.on("data", (chunk: any) => {
			const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			this.onData(bufferChunk);
		});

		this._readStream.on("close", () => {
			if (!closed) {
				closed = true;
				this._onConnectionClosed();
			}
		});

		this._writeStream.on("close", () => {
			if (!closed) {
				closed = true;
				this._onConnectionClosed();
			}
		});
	}

	private onData(chunk: Buffer): void {
		try {
			// Concatenate the existing buffer with the new chunk
			const newBuffer = new Uint8Array(this.buffer.length + chunk.length);
			newBuffer.set(this.buffer);
			newBuffer.set(chunk, this.buffer.length);
			this.buffer = newBuffer;

			while (true) {
				if (this.nextMessageLength === -1) {
					const headers = this.tryReadHeaders();
					if (!headers) {
						return;
					}
					const contentLength = headers.get('content-length');
					if (!contentLength) {
						throw new Error(`Header must provide a Content-Length property.`);
					}
					const length = parseInt(contentLength);
					if (isNaN(length)) {
						throw new Error(`Content-Length value must be a number. Got ${contentLength}`);
					}
					this.nextMessageLength = length;
				}

				const body = this.tryReadBody(this.nextMessageLength);
				if (body === undefined) {
					// We haven't received the full message yet
					return;
				}

				this.nextMessageLength = -1;
				const messageStr = body.toString('utf8');
				const message = JSON.parse(messageStr) as Message;
				this._onMessage(message);
			}
		} catch (error) {
			console.error('Error processing LSP message:', error);
		}
	}

	private tryReadHeaders(): Map<string, string> | undefined {
		// Convert to Buffer to use indexOf with string
		const bufferView = Buffer.from(this.buffer);
		const headerEnd = bufferView.indexOf('\r\n\r\n');
		if (headerEnd === -1) {
			return undefined;
		}

		const headerSection = this.buffer.slice(0, headerEnd);
		this.buffer = this.buffer.slice(headerEnd + 4); // Skip the \r\n\r\n

		const headers = new Map<string, string>();
		const headerText = Buffer.from(headerSection).toString('ascii');
		const headerLines = headerText.split('\r\n');

		for (const line of headerLines) {
			if (line.trim() === '') continue;
			const colonIndex = line.indexOf(':');
			if (colonIndex === -1) {
				throw new Error(`Message header must separate key and value using ':'\n${line}`);
			}
			const key = line.substring(0, colonIndex).trim().toLowerCase();
			const value = line.substring(colonIndex + 1).trim();
			headers.set(key, value);
		}

		return headers;
	}

	private tryReadBody(length: number): Buffer | undefined {
		if (this.buffer.length < length) {
			return undefined;
		}

		const body = Buffer.from(this.buffer.slice(0, length));
		this.buffer = this.buffer.slice(length);
		return body;
	}

	/**
	 * Closes the write stream.
	 */
	public close(): void {
		this._writeStream.end();
	}

	public dispose(): void {
		this.close();
	}

	public write(message: Message): Promise<void> {
		const messageStr = JSON.stringify(message);
		const contentLength = Buffer.byteLength(messageStr, 'utf8');
		const header = `Content-Length: ${contentLength}\r\n\r\n`;

		return new Promise((res, rej) => {
			this._writeStream.write(header + messageStr, 'utf8', (err) => {
				if (err) {
					rej(err);
				} else {
					res();
				}
			});
		});
	}

	public toString(): string {
		return `${this.id}@stream-with-headers`;
	}
}
