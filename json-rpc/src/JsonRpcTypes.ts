// These types model the JSON RPC 2.0 Specification (see https://www.jsonrpc.org/specification).

export function isRequestOrNotification(msg: Message): msg is IRequestMessage {
	return (msg as any).method !== undefined;
}

export type JSONObject = { [key: string]: JSONValue | undefined };
export interface JSONArray extends Array<JSONValue> { }
export type JSONValue =
	| string
	| number
	| boolean
	| null
	| JSONObject
	| JSONArray;

export type Message = IRequestMessage | IResponseMessage;

/**
 * Represents a request or a notification.
 */
export interface IRequestMessage {
	jsonrpc: "2.0";
	/**  must not match `rpc\..*` */
	method: string;
	params?: JSONArray | JSONObject;
	/** Is not set if and only if the request is a notification. */
	id?: RequestId;
	/** Requests don't have a result. */
	result?: never;
}

export type RequestId = number | string;

/**
 * Either result or error is set.
 */
export interface IResponseMessage {
	jsonrpc: "2.0";
	/**
	 * This member is REQUIRED on success.
	 * This member MUST NOT exist if there was an error invoking the method.
	 * The value of this member is determined by the method invoked on the Server.
	 */
	result?: JSONValue;
	/**
	 * This member is REQUIRED on error.
	 * This member MUST NOT exist if there was no error triggered during invocation.
	 */
	error?: ErrorObject;
	/**
	 * If there was an error in detecting the id in the Request object
	 * (e.g. Parse error/Invalid Request), it MUST be Null.
	 */
	id: RequestId | null;
	method?: never;
}

export interface ErrorObject {
	/** A Number that indicates the error type that occurred. */
	code: ErrorCode;
	/** The message SHOULD be limited to a concise single sentence. */
	message: string;
	/**
	 * A Primitive or Structured value that contains additional information about the error.
	 * This may be omitted.
	 * The value of this member is defined by the Server (e.g. detailed error information, nested errors etc.).
	 */
	data?: JSONValue;
}

export namespace ErrorObject {
	export function create(obj: ErrorObject): ErrorObject {
		return obj;
	}
}

export interface ErrorCode extends Number { }

export namespace ErrorCode {
	/**
	 * Invalid JSON was received by the server.
	 * An error occurred on the server while parsing the JSON text.
	 */
	export const parseError = -32700 as ErrorCode;

	/**
	 * The JSON sent is not a valid Request object.
	 */
	export const invalidRequest = -32600 as ErrorCode;

	/**
	 * The method does not exist/is not available.
	 */
	export const methodNotFound = -32601 as ErrorCode;

	/**
	 * Invalid method parameter(s).
	 */
	export const invalidParams = -32602 as ErrorCode;

	/**
	 * 	Internal JSON-RPC error.
	 */
	export const internalError = -32603 as ErrorCode;

	/**
	 * implementation-defined server-errors.
	 */
	export function isServerError(code: number): boolean {
		return -32099 <= code && code <= -32000;
	}

	/**
	 * implementation-defined server-errors.
	 */
	export function serverError(code: number): ErrorCode {
		if (!isServerError(code)) {
			throw new Error("Invalid range for a server error.");
		}
		return code as ErrorCode;
	}

	/**
	 * Non-spec.
	 */
	export const unexpectedServerError = -32000 as ErrorCode;

	export function isApplicationError(code: number): boolean {
		// todo implement proper checks
		return true;
	}

	export function applicationError(code: number): ErrorCode {
		if (!isApplicationError(code)) {
			throw new Error("Invalid range for an application error.");
		}
		return code as ErrorCode;
	}

	/**
	 * Non-spec.
	 */
	export const genericApplicationError = -320100 as ErrorCode;
}
