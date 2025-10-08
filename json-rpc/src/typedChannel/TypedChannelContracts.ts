import { RequestType, NotificationType, TypedChannel, ErrorResult, RequestHandlerFunc, TypedChannelBase, TypedChannelOptions, OptionalMethodNotFound } from "./TypedChannel";
import { RequestId, ErrorCode } from "../JsonRpcTypes";
import { IMessageTransport } from "../MessageTransport";
import { SerializerT } from "../schema";
import { IDisposable } from "../common";

/**
 * Describes a request type as part of a `Contract`.
 * The method is inferred from its position in the contract if not provided.
 */
export type ContractRequestType<
	TParams = unknown,
	TResult = unknown,
	TError = unknown,
	TOptional extends boolean = boolean
> = RequestType<TParams, TResult, TError, string | undefined, TOptional>;

export type AnyRequestContract = ContractRequestType<any, any, any, boolean>;
export type AsRequestContract<T extends AnyRequestContract> = T;

/**
 * Describes a notification type as part of a `Contract`.
 * The method is inferred from its position in the contract if not provided.
 */
export type ContractNotificationType<TArgs = unknown> = NotificationType<TArgs, string | undefined>;

export type AsNotificationContract<T extends ContractNotificationType> = T;

/**
 * Describes one side of a contract.
 */
export type OneSideContract = Record<string, AnyRequestContract | ContractNotificationType<any>>;
export type AsOneSideContract<T extends OneSideContract> = T;

export type ContractToRequest<TRequestMap extends OneSideContract> = {
	[TRequest in keyof TRequestMap]: TRequestMap[TRequest] extends AnyRequestContract
	? RequestType<
		SerializerT<TRequestMap[TRequest]["paramsSerializer"]>,
		SerializerT<TRequestMap[TRequest]["resultSerializer"]>,
		SerializerT<TRequestMap[TRequest]["errorSerializer"]>
	>
	: NotificationType<SerializerT<TRequestMap[TRequest]["paramsSerializer"]>>;
};

export type EmptyObjectToVoid<T> = {} extends T ? void | T : T;

export type ContractInterfaceOf<
	TRequestMap extends OneSideContract,
	TContext
> = {
		[TRequest in keyof TRequestMap]:
		(
			arg: EmptyObjectToVoid<SerializerT<TRequestMap[TRequest]["paramsSerializer"]>>,
			context: TContext,
		) => TRequestMap[TRequest] extends AnyRequestContract
			? Promise<SerializerT<TRequestMap[TRequest]["resultSerializer"]>> | (TRequestMap[TRequest]['isOptional'] extends true ? OptionalMethodNotFound : never)
			: void;
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

	[IsErrorWrapper]!: true;
	constructor(public readonly error: ErrorResult<TError>) { }
}

export type ContractHandlerOf<
	TRequestMap extends OneSideContract,
	TCounterPartRequestMap extends OneSideContract,
	TContext,
	TOtherContext
> = ObjectWithOptional<{
	[TKey in keyof TRequestMap]: TRequestMap[TKey] extends AnyRequestContract
	? {
		optional: TRequestMap[TKey]['isOptional'],
		type: (
			arg: SerializerT<TRequestMap[TKey]["paramsSerializer"]>,
			info: RequestHandlerInfo<
				SerializerT<TRequestMap[TKey]["errorSerializer"]>,
				ContractInterfaceOf<TCounterPartRequestMap, TOtherContext>,
				TContext
			>
		) => Promise<
			| SerializerT<TRequestMap[TKey]["resultSerializer"]>
			| ErrorWrapper<SerializerT<TRequestMap[TKey]["errorSerializer"]>>
		>
	} :
	{
		optional: true,
		type: (
			arg: SerializerT<TRequestMap[TKey]["paramsSerializer"]>,
			info: HandlerInfo<
				ContractInterfaceOf<TCounterPartRequestMap, TOtherContext>,
				TContext
			>
		) => void;
	}
}>;

export type ObjectWithOptional<T extends Record<string, { optional: boolean; type: any }>> =
	(
		{ [K in keyof T]?: T[K]["type"] } &
		{ [K in keyof T as T[K]["optional"] extends false ? K : never]-?: T[K]["type"] }
	) extends infer O ? { [K in keyof O]: O[K] } : never


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
export function contract<
	TServer extends OneSideContract,
	TClient extends OneSideContract,
	TTags extends string = never
>(contractObj: {
	name: string;
	tags?: TTags[];
	server: TServer;
	client: TClient;
}): Contract<TTags, { server: TServer; client: TClient }, void, void> {
	const server = transform(contractObj["server"]);
	const client = transform(contractObj["client"]);
	return new Contract(contractObj.tags || [], server as any, client as any);
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
export interface HandlerInfo<TCounterPart, TListenerContext = never> {
	context: TListenerContext;
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

export class Contract<
	TTags extends string,
	TContractObject extends ContractObject,
	TContext,
	TSendContext
> {
	protected _onlyDesignTime() {
		return new Error("This property is not meant to be accessed at runtime");
	}

	public get TContractObject(): TContractObject {
		throw this._onlyDesignTime();
	}

	public get TClientInterface(): ContractInterfaceOf<TContractObject["client"], TContext> {
		throw this._onlyDesignTime();
	}

	public get TServerInterface(): ContractInterfaceOf<TContractObject["server"], TContext> {
		throw this._onlyDesignTime();
	}

	public get TClientHandler(): ContractHandlerOf<TContractObject["client"], TContractObject["server"], TContext, TSendContext> {
		throw this._onlyDesignTime();
	}

	public get TServerHandler(): ContractHandlerOf<TContractObject["server"], TContractObject["client"], TContext, TSendContext> {
		throw this._onlyDesignTime();
	}

	public get TTags(): TTags {
		throw this._onlyDesignTime();
	}

	constructor(
		public readonly tags: TTags[] = [],
		public readonly server: ContractToRequest<TContractObject["server"]>,
		public readonly client: ContractToRequest<TContractObject["client"]>
	) { }

	protected getInterface(
		typedChannel: TypedChannelBase<TContext, TSendContext>,
		myContract: Record<
			string,
			NotificationType<any> | RequestType<any, any, any>
		>,
		otherContract: Record<
			string,
			NotificationType<any> | RequestType<any, any, any>
		>,
		myInterface: Record<string, Function>
	): { counterpart: Record<string, unknown> } & IDisposable {
		const counterpart = this.buildCounterpart(typedChannel, otherContract);
		const disposable = this.registerHandlers(
			typedChannel,
			myContract,
			myInterface,
			counterpart
		);

		return { counterpart, dispose: () => disposable.dispose() };
	}

	private buildCounterpart(
		typedChannel: TypedChannelBase<TContext, TSendContext>,
		otherContract: Record<
			string,
			NotificationType<any> | RequestType<any, any, any>
		>
	): Record<string, unknown> {
		const counterpart: Record<string, unknown> = {};
		for (const [key, req] of Object.entries(otherContract)) {
			let method;
			if (req.kind === "request") {
				if (req.isOptional) {
					method = async (args: any, context: TSendContext) => {
						if (args === undefined) {
							args = {};
						}
						try {
							return await typedChannel.request(req, args, context);
						} catch (error: any) {
							// TODO use proper types
							if (error && error.code === ErrorCode.methodNotFound) {
								return OptionalMethodNotFound;
							}
							throw error;
						}
					};
				} else {
					method = (args: any, context: TSendContext) => {
						if (args === undefined) {
							args = {};
						}
						return typedChannel.request(req, args, context);
					};
				}
			} else {
				method = (args: any, context: TSendContext) => {
					if (args === undefined) {
						args = {};
					}
					return typedChannel.notify(req, args, context);
				};
			}

			counterpart[key] = method;
		}
		return counterpart;
	}

	private registerHandlers<TListenerContext, THandlerContext>(
		typedChannel: TypedChannelBase<TListenerContext, THandlerContext>,
		myContract: Record<
			string,
			NotificationType<any> | RequestType<any, any, any>
		>,
		myInterface: Record<string, Function>,
		counterpart: Record<string, unknown>
	): IDisposable {
		const disposables: IDisposable[] = [];

		for (const [key, req] of Object.entries(myContract)) {
			if (req.kind === "request") {
				let method = myInterface[key];
				if (!method) {
					continue;
				}
				const handler = this.createRequestHandler<TListenerContext>(counterpart, method);
				disposables.push(typedChannel.registerRequestHandler(req, handler));
			} else {
				const method = myInterface[key];
				if (method) {
					disposables.push(
						typedChannel.registerNotificationHandler(req, (args, context) => {
							const notificationInfo: HandlerInfo<any, TListenerContext> = { context, counterpart };
							// TODO maybe await and log errors?
							method(args, notificationInfo);
						})
					);
				}
			}
		}

		return { dispose: () => disposables.forEach(d => d.dispose()) };
	}

	private createRequestHandler<TListenerContext>(
		counterpart: Record<string, unknown>,
		method: Function
	): RequestHandlerFunc<any, any, any, TListenerContext> {
		return async (args, requestId, listenerContext) => {
			const requestInfo: RequestHandlerInfo<any, any, TListenerContext> = {
				context: listenerContext,
				counterpart,
				newErr: ErrorWrapper.factory,
				requestId,
			};
			const result = await method(args, requestInfo);
			if (result instanceof ErrorWrapper) {
				return result.error;
			}
			return { ok: result };
		};
	}

	/**
	 * Gets a server object directly from a stream by constructing a new `TypedChannel`.
	 * It also registers the client implementation to the stream.
	 * The channel starts listening immediately.
	 */
	public static getServerFromStream<
		TContract extends Contract<any, { client: {}, server: {} }, void, void>
	>(
		contract: TContract,
		stream: IMessageTransport,
		options: TypedChannelOptions,
		clientImplementation: TContract["TClientHandler"]
	): {
		server: TContract["TServerInterface"];
		channel: TypedChannel<void, void>;
	} {
		const channel = TypedChannel.fromTransport(stream, options);
		const { server } = contract.getServer(channel, clientImplementation);
		channel.startListen();

		return { channel, server };
	}

	/**
	 * Gets a client object directly from a stream by constructing a new `TypedChannel`.
	 * It also registers the server implementation to the stream.
	 * The channel starts listening immediately.
	 */
	public static registerServerToStream<
		TContract extends Contract<any, { client: {}, server: {} }, void, void>
	>(
		contract: TContract,
		stream: IMessageTransport,
		options: TypedChannelOptions,
		serverImplementation: TContract["TServerHandler"]
	): {
		client: TContract["TClientInterface"];
		channel: TypedChannel<void, void>;
	} {
		const channel = TypedChannel.fromTransport(stream, options);
		const { client } = contract.registerServer(channel, serverImplementation);
		channel.startListen();
		return { channel, client };
	}

	public getServer(
		typedChannel: TypedChannelBase<TContext, TSendContext>,
		clientImplementation: this["TClientHandler"]
	): {
		server: ContractInterfaceOf<TContractObject["server"], TContext>;
	} & IDisposable {
		const { counterpart, dispose } = this.getInterface(typedChannel, this.client, this.server, clientImplementation);

		return { server: counterpart as any, dispose };
	}

	public registerServer(
		typedChannel: TypedChannelBase<TContext, TSendContext>,
		serverImplementation: this["TServerHandler"]
	): {
		client: ContractInterfaceOf<TContractObject["client"], TContext>;
	} & IDisposable {
		const { counterpart, dispose } = this.getInterface(typedChannel, this.server, this.client, serverImplementation);

		return { client: counterpart as any, dispose };
	}

	public withContext<TNewContext, TNewSendContext = TSendContext>(): Contract<
		TTags,
		TContractObject,
		TNewContext,
		TNewSendContext
	> {
		return new Contract(this.tags, this.server, this.client);
	}
}
