import { Message } from "./JsonRpcTypes";

/**
 * Represents a log entry used by `RpcLogger`.
 */
export interface LogEntry {
	/**
	 * A human readable description of the log entry.
	 */
	text: string;
	/**
	 * Data regarding this log entry.
	 */
	data?: object;
	/**
	 * The json message the log entry is about, if any.
	 */
	message?: Message;
	/**
	 * The exception the log entry is about, if any.
	 */
	exception?: unknown;
}

export interface RpcLogger {
	/**
	 * Logs an event that ideally should not happen.
	 */
	warn(logEntry: LogEntry): void;

	/**
	 * Logs an event that might be unusual.
	 */
	debug(logEntry: LogEntry): void;

	/**
	 * Traces all communication.
	 */
	trace(logEntry: LogEntry): void;
}

/**
 * A `RpcLogger` that prints everything to `console`.
 */
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
