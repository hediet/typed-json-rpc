import { Message } from "./JsonRpcTypes";

export interface LogEntry {
	text: string;
	data?: object;
	message?: Message;
	exception?: unknown;
}

export interface RpcLogger {
	debug(logEntry: LogEntry): void;
	warn(logEntry: LogEntry): void;
	trace(logEntry: LogEntry): void;
}

export class ConsoleRpcLogger implements RpcLogger {
	public debug(logEntry: LogEntry): void {
		console.log(logEntry.text, logEntry.exception);
	}

	public warn(logEntry: LogEntry): void {
		console.warn(logEntry.text, logEntry.exception);
	}

	public trace(logEntry: LogEntry): void {
		console.log(logEntry.text, logEntry.exception);
	}
}
