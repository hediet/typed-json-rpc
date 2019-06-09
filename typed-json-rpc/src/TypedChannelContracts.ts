import * as t from "io-ts";
import {
	RequestType,
	NotificationType,
	TypedChannel,
	RuntimeJsonType,
	voidType,
	RuntimeJsonTypeArrOrObj,
	RequestHandlingError,
	ErrorResult,
	RequestHandlerFunc,
} from "./TypedChannel";
import { RequestId } from "./JsonRpcTypes";
import { MessageStream } from "./MessageStream";
import { RpcLogger } from "./Logger";
import { Disposable, dispose } from "@hediet/std/disposable";

/**
 * Describes a request type as part of a `Contract`.
 * The method is inferred from its position in the contract if not provided.
 */
export type ContractRequestType<
	TParams = unknown,
	TResult = unknown,
	TError = unknown
> = RequestType<TParams, TResult, TError, string | undefined>;

export type AnyRequestContract = ContractRequestType<any, any, any>;
export type AsRequestContract<T extends AnyRequestContract> = T;

/**
 * Describes a notification type as part of a `Contract`.
 * The method is inferred from its position in the contract if not provided.
 */
export type ContractNotificationType<TArgs = unknown> = NotificationType<
	TArgs,
	string | undefined
>;

export type AsNotificationContract<T extends ContractNotificationType> = T;

/**
 * Describes a request type as part of a `Contract`.
 */
export function requestContract<
	TParams extends RuntimeJsonTypeArrOrObj<any> = RuntimeJsonTypeArrOrObj<{}>,
	TResult extends RuntimeJsonType<any> = RuntimeJsonType<void>,
	TError extends RuntimeJsonType<any> = RuntimeJsonType<undefined>
>(request: {
	method?: string;
	params?: TParams;
	result?: TResult;
	error?: TError;
}): ContractRequestType<TParams["_A"], TResult["_A"], TError["_A"]> {
	return new RequestType(
		request.method,
		request.params ? request.params : t.type({}),
		request.result ? request.result : voidType,
		request.error ? request.error : voidType
	);
}

/**
 * Describes a notification type as part of a `Contract`.
 */
export function notificationContract<
	TParams extends RuntimeJsonTypeArrOrObj<any> = RuntimeJsonTypeArrOrObj<{}>
>(notification: {
	method?: string;
	params?: TParams;
}): ContractNotificationType<TParams["_A"]> {
	return new NotificationType(
		notification.method,
		notification.params ? notification.params : t.type({})
	);
}

/**
 * Describes one side of a contract.
 */
export type OneSideContract = Record<
	string,
	AnyRequestContract | ContractNotificationType<any>
>;
export type AsOneSideContract<T extends OneSideContract> = T;

export type ContractToRequest<TRequestMap extends OneSideContract> = {
	[TRequest in keyof TRequestMap]: TRequestMap[TRequest] extends AnyRequestContract
		? RequestType<
				TRequestMap[TRequest]["paramType"]["_A"],
				TRequestMap[TRequest]["resultType"]["_A"],
				TRequestMap[TRequest]["errorType"]["_A"]
		  >
		: NotificationType<TRequestMap[TRequest]["paramType"]["_A"]>
};

export type EmptyObjectToVoid<T> = {} extends T ? (void | T) : T;

export type ContractInterfaceOf<TRequestMap extends OneSideContract> = {
	[TRequest in keyof TRequestMap]: TRequestMap[TRequest] extends AnyRequestContract
		? (
				arg: EmptyObjectToVoid<TRequestMap[TRequest]["paramType"]["_A"]>
		  ) => Promise<TRequestMap[TRequest]["resultType"]["_A"]>
		: (
				arg: EmptyObjectToVoid<TRequestMap[TRequest]["paramType"]["_A"]>
		  ) => void
};

/** Marks a type as error wrapper. */
export const IsErrorWrapper = Symbol();

/**
 * Wraps an error so that it can be distinguished from a successfully returned result.
 */
export class ErrorWrapper<TError> {
	public static factory = (error: ErrorResult<unknown>) => {
		return new ErrorWrapper<unknown>(error);
	};

	[IsErrorWrapper]: true;
	constructor(public readonly error: ErrorResult<TError>) {}
}

export type ContractHandlerOf<
	TRequestMap extends OneSideContract,
	TCounterPartRequestMap extends OneSideContract,
	TContext
> = {
	[TKey in RequestKeys<
		TRequestMap
	>]: TRequestMap[TKey] extends AnyRequestContract
		? (
				arg: TRequestMap[TKey]["paramType"]["_A"],
				info: RequestHandlerInfo<
					TRequestMap[TKey]["errorType"]["_A"],
					ContractInterfaceOf<TCounterPartRequestMap>,
					TContext
				>
		  ) => Promise<
				| TRequestMap[TKey]["resultType"]["_A"]
				| ErrorWrapper<TRequestMap[TKey]["errorType"]["_A"]>
		  >
		: never // cannot happen
} &
	{
		[TKey in NotificationKeys<TRequestMap>]?: (
			arg: TRequestMap[TKey]["paramType"]["_A"],
			info: HandlerInfo<
				ContractInterfaceOf<TCounterPartRequestMap>,
				TContext
			>
		) => void
	};

export type RequestKeys<TRequestMap extends OneSideContract> = {
	[TRequest in keyof TRequestMap]: TRequestMap[TRequest] extends AnyRequestContract
		? TRequest
		: never
}[keyof TRequestMap];

export type NotificationKeys<TRequestMap extends OneSideContract> = {
	[TRequest in keyof TRequestMap]: TRequestMap[TRequest] extends AnyRequestContract
		? never
		: TRequest
}[keyof TRequestMap];

/**
 * Describes a contract.
 */
export interface ContractObject {
	server: OneSideContract;
	client: OneSideContract;
}

/**
 * Describes a new contract.
 */
export function contract<TContractObject extends ContractObject>(
	contractObj: TContractObject
): Contract<never, TContractObject>;
export function contract<
	TTags extends string,
	TContractObject extends ContractObject
>(
	tags: TTags[],
	contractObj: TContractObject
): Contract<TTags, TContractObject>;
export function contract<TContractObject extends ContractObject>(
	...args: any[]
): Contract<string, TContractObject> {
	let tags = [];
	let contractObj: TContractObject = undefined!;
	if (args.length == 2) {
		tags = args[0];
		contractObj = args[1];
	} else {
		contractObj = args[0];
	}

	const server = transform(contractObj["server"]);
	const client = transform(contractObj["client"]);
	return new Contract(tags, server as any, client as any);
}

function transform(
	requestMap: OneSideContract
): Record<string, NotificationType | RequestType> {
	const result: Record<string, NotificationType | RequestType> = {};
	for (const [key, req] of Object.entries(requestMap)) {
		const method = req.method ? req.method : key;
		result[key] = req.withMethod(method);
	}
	return result;
}

/**
 * Provides additional information when handling a request or a notification.
 */
export interface HandlerInfo<TCounterPart, TContext = never> {
	context: TContext;
	/**
	 * The implementation of the other contract.
	 */
	counterpart: TCounterPart;
}

/**
 * Provides additional information when handling a request.
 */
export interface RequestHandlerInfo<TError, TCounterPart, TContext = never>
	extends HandlerInfo<TCounterPart, TContext> {
	/**
	 * Creates a new error object that can be returned in request handlers.
	 */
	newErr(error: ErrorResult<TError>): ErrorWrapper<TError>;
	/**
	 * The id of the current request.
	 */
	requestId: RequestId;
}

export abstract class AbstractContract<
	TTags extends string,
	TContractObject extends ContractObject
> {
	protected onlyDesignTime() {
		return new Error(
			"This property is not meant to be accessed at runtime"
		);
	}

	public get TContractObject(): TContractObject {
		throw this.onlyDesignTime();
	}

	public get TClientInterface(): ContractInterfaceOf<
		TContractObject["client"]
	> {
		throw this.onlyDesignTime();
	}

	public get TServerInterface(): ContractInterfaceOf<
		TContractObject["server"]
	> {
		throw this.onlyDesignTime();
	}

	public get TTags(): TTags {
		throw this.onlyDesignTime();
	}

	constructor(
		public readonly tags: TTags[] = [],
		public readonly server: ContractToRequest<TContractObject["server"]>,
		public readonly client: ContractToRequest<TContractObject["client"]>
	) {}

	protected getInterface<TContext>(
		typedChannel: TypedChannel,
		myContract: Record<
			string,
			NotificationType<any> | RequestType<any, any, any>
		>,
		otherContract: Record<
			string,
			NotificationType<any> | RequestType<any, any, any>
		>,
		myInterface: Record<string, Function>,
		context: TContext
	): { counterpart: Record<string, unknown> } & Disposable {
		const counterpart = this.buildCounterpart(typedChannel, otherContract);
		const disposable = this.registerHandlers(
			typedChannel,
			myContract,
			myInterface,
			context,
			counterpart
		);

		return { counterpart, dispose: () => disposable.dispose() };
	}

	private buildCounterpart(
		typedChannel: TypedChannel,
		otherContract: Record<
			string,
			NotificationType<any> | RequestType<any, any, any>
		>
	): Record<string, unknown> {
		const counterpart: Record<string, unknown> = {};
		for (const [key, req] of Object.entries(otherContract)) {
			let method;
			if (req.kind === "request") {
				method = (args: any) => {
					if (args === undefined) {
						args = {};
					}
					return typedChannel.request(req, args);
				};
			} else {
				method = (args: any) => {
					if (args === undefined) {
						args = {};
					}
					return typedChannel.notify(req, args);
				};
			}

			counterpart[key] = method;
		}
		return counterpart;
	}

	private registerHandlers<TContext>(
		typedChannel: TypedChannel,
		myContract: Record<
			string,
			NotificationType<any> | RequestType<any, any, any>
		>,
		myInterface: Record<string, Function>,
		context: TContext,
		counterpart: Record<string, unknown>
	): Disposable {
		const disposables = new Array<Disposable>();

		const notificationInfo: HandlerInfo<any, TContext> = {
			context,
			counterpart,
		};

		for (const [key, req] of Object.entries(myContract)) {
			if (req.kind === "request") {
				const method = myInterface[key];
				if (!method) {
					throw new Error(`No handler for "${key}" given!`);
				}
				const handler = this.createRequestHandler<TContext>(
					context,
					counterpart,
					method
				);
				disposables.push(
					typedChannel.registerRequestHandler(req, handler)
				);
			} else {
				const method = myInterface[key];
				if (method) {
					disposables.push(
						typedChannel.registerNotificationHandler(req, args => {
							// TODO maybe await and log errors?
							method(args, notificationInfo);
						})
					);
				}
			}
		}

		return Disposable.create(disposables);
	}

	private createRequestHandler<TContext>(
		context: TContext,
		counterpart: Record<string, unknown>,
		method: Function
	): RequestHandlerFunc<any, any, any> {
		return async (args, requestId) => {
			try {
				const requestInfo: RequestHandlerInfo<any, any, TContext> = {
					context,
					counterpart,
					newErr: ErrorWrapper.factory,
					requestId,
				};
				const result = await method(args, requestInfo);
				if (result instanceof ErrorWrapper) {
					return result.error;
				}
				return { ok: result };
			} catch (e) {
				if (e instanceof RequestHandlingError) {
					return {
						error: e.data,
						errorCode: e.code,
						errorMessage: e.message,
					};
				} else {
					throw e;
				}
			}
		};
	}
}

export class Contract<
	TTags extends string,
	TContractObject extends ContractObject
> extends AbstractContract<TTags, TContractObject> {
	public get TClientHandler(): ContractHandlerOf<
		TContractObject["client"],
		TContractObject["server"],
		undefined
	> {
		throw this.onlyDesignTime();
	}

	public get TServerHandler(): ContractHandlerOf<
		TContractObject["server"],
		TContractObject["client"],
		undefined
	> {
		throw this.onlyDesignTime();
	}

	/**
	 * Gets a server object directly from a stream by constructing a new `TypedChannel`.
	 * It also registers the client implementation to the stream.
	 * The channel starts listening immediately.
	 */
	public getServerFromStream(
		stream: MessageStream,
		logger: RpcLogger | undefined,
		clientImplementation: this["TClientHandler"]
	): {
		server: ContractInterfaceOf<TContractObject["server"]>;
		channel: TypedChannel;
	} {
		const channel = TypedChannel.fromStream(stream, logger);
		const { server } = this.getServer(channel, clientImplementation);
		channel.startListen();

		return { channel, server };
	}

	/**
	 * Gets a client object directly from a stream by constructing a new `TypedChannel`.
	 * It also registers the server implementation to the stream.
	 * The channel starts listening immediately.
	 */
	public registerServerToStream(
		stream: MessageStream,
		logger: RpcLogger | undefined,
		serverImplementation: this["TServerHandler"]
	): {
		client: ContractInterfaceOf<TContractObject["client"]>;
		channel: TypedChannel;
	} {
		const channel = TypedChannel.fromStream(stream, logger);
		const { client } = this.registerServer(channel, serverImplementation);
		channel.startListen();
		return { channel, client };
	}

	public getServer(
		typedChannel: TypedChannel,
		clientImplementation: this["TClientHandler"]
	): { server: ContractInterfaceOf<TContractObject["server"]> } & Disposable {
		const { counterpart, dispose } = this.getInterface(
			typedChannel,
			this.client,
			this.server,
			clientImplementation,
			undefined
		);

		return { server: counterpart as any, dispose };
	}

	public registerServer(
		typedChannel: TypedChannel,
		serverImplementation: this["TServerHandler"]
	): { client: ContractInterfaceOf<TContractObject["client"]> } & Disposable {
		const { counterpart, dispose } = this.getInterface(
			typedChannel,
			this.server,
			this.client,
			serverImplementation,
			undefined
		);

		return { client: counterpart as any, dispose };
	}

	public withContext<TContext>(): ContractWithContext<
		TTags,
		TContractObject,
		TContext
	> {
		return new ContractWithContext(this.tags, this.server, this.client);
	}
}

export class ContractWithContext<
	TTags extends string,
	TContractObject extends ContractObject,
	TContext
> extends AbstractContract<TTags, TContractObject> {
	public get TClientHandler(): ContractHandlerOf<
		TContractObject["client"],
		TContractObject["server"],
		TContext
	> {
		throw this.onlyDesignTime();
	}

	public get TServerHandler(): ContractHandlerOf<
		TContractObject["server"],
		TContractObject["client"],
		TContext
	> {
		throw this.onlyDesignTime();
	}

	public getServer(
		typedChannel: TypedChannel,
		context: TContext,
		clientImplementation: this["TClientHandler"]
	): { server: ContractInterfaceOf<TContractObject["server"]> } & Disposable {
		const { counterpart, dispose } = this.getInterface(
			typedChannel,
			this.client,
			this.server,
			clientImplementation,
			context
		);
		return { server: counterpart as any, dispose };
	}

	public registerServer(
		typedChannel: TypedChannel,
		context: TContext,
		serverImplementation: this["TServerHandler"]
	): { client: ContractInterfaceOf<TContractObject["client"]> } & Disposable {
		const { counterpart, dispose } = this.getInterface(
			typedChannel,
			this.server,
			this.client,
			serverImplementation,
			context
		);
		return { client: counterpart as any, dispose };
	}
}
