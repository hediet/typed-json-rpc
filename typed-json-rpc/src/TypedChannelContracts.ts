import * as t from "io-ts";
import {
	RequestType,
	NotificationType,
	TypedChannel,
	RuntimeJsonType,
	CouldNotInfer,
	CouldNotBeInferred,
	AsType,
	voidType,
	RuntimeJsonTypeArrOrObj,
	RequestHandlingError,
	ErrorResult,
} from "./TypedChannel";
import { ErrorCode, ErrorObject, RequestId, JSONValue } from "./JsonRpcTypes";

export type AnyRequestContract = RequestContract<any, any, any>;

export interface RequestContract<
	TParams = unknown,
	TResult = unknown,
	TError = unknown
> {
	kind: "request";
	params: RuntimeJsonTypeArrOrObj<TParams>;
	result: RuntimeJsonType<TResult>;
	error: RuntimeJsonType<TError>;
}

export interface NotificationContract<TArgs = unknown> {
	kind: "notification";
	params: RuntimeJsonTypeArrOrObj<TArgs>;
}

export interface HasMethod {
	method: string | undefined;
}

export function requestContract<
	TParams extends RuntimeJsonTypeArrOrObj<any> = RuntimeJsonTypeArrOrObj<{}>,
	TResult extends RuntimeJsonType<any> = RuntimeJsonType<void>,
	TError extends RuntimeJsonType<any> = RuntimeJsonType<undefined>
>(request: {
	method?: string;
	params?: TParams;
	result?: TResult;
	error?: TError;
}): RequestContract<TParams["_A"], TResult["_A"], TError["_A"]> & HasMethod {
	return {
		kind: "request",
		method: request.method,
		params: (request.params ? request.params : t.type({})) as any,
		error: (request.error ? request.error : voidType) as any,
		result: (request.result ? request.result : voidType) as any,
	};
}

export function notificationContract<
	TParams extends RuntimeJsonTypeArrOrObj<any> = RuntimeJsonTypeArrOrObj<{}>
>(notification: {
	method?: string;
	params?: TParams;
}): NotificationContract<TParams["_A"]> & HasMethod {
	return {
		kind: "notification",
		method: notification.method,
		params: (notification.params ? notification.params : t.type({})) as any,
	};
}

export type AsOneSideContract<T extends OneSideContract> = T;

export type AsRequestContract<T extends AnyRequestContract> = T;

export type AsNotificationContract<T extends NotificationContract> = T;

export type OneSideContract<TExtra = object> = Record<
	string,
	(AnyRequestContract | NotificationContract<any>) & TExtra
>;

export interface ContractObject<TExtra = {}> {
	server: OneSideContract<TExtra>;
	client: OneSideContract<TExtra>;
}

export type ContractToRequest<TRequestMap extends OneSideContract> = {
	[TRequest in keyof TRequestMap]: TRequestMap[TRequest] extends AnyRequestContract
		? RequestType<
				TRequestMap[TRequest]["params"]["_A"],
				TRequestMap[TRequest]["result"]["_A"],
				TRequestMap[TRequest]["error"]["_A"]
		  >
		: NotificationType<TRequestMap[TRequest]["params"]["_A"]>
};

export type ContractInterfaceOf<TRequestMap extends OneSideContract> = {
	[TRequest in keyof TRequestMap]: TRequestMap[TRequest] extends AnyRequestContract
		? (
				arg: TRequestMap[TRequest]["params"]["_A"]
		  ) => Promise<TRequestMap[TRequest]["result"]["_A"]>
		: (arg: TRequestMap[TRequest]["params"]["_A"]) => void
};

export const IsErrorWrapper = Symbol();

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
				arg: TRequestMap[TKey]["params"]["_A"],
				info: RequestHandlerInfo<
					TRequestMap[TKey]["error"]["_A"],
					ContractInterfaceOf<TCounterPartRequestMap>,
					TContext
				>
		  ) => Promise<
				| TRequestMap[TKey]["result"]["_A"]
				| ErrorWrapper<TRequestMap[TKey]["error"]["_A"]>
		  >
		: never // cannot happen
} &
	{
		[TKey in NotificationKeys<TRequestMap>]?: (
			arg: TRequestMap[TKey]["params"]["_A"],
			info: NotificationHandlerInfo<
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

export function contract<TContractObject extends ContractObject<HasMethod>>(
	contractObj: TContractObject
): Contract<never, TContractObject>;
export function contract<
	TTags extends string,
	TContractObject extends ContractObject<HasMethod>
>(
	tags: TTags[],
	contractObj: TContractObject
): Contract<TTags, TContractObject>;
export function contract<TContractObject extends ContractObject<HasMethod>>(
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
	requestMap: OneSideContract<HasMethod>
): Record<string, NotificationType | RequestType> {
	const result: Record<string, NotificationType | RequestType> = {};
	for (const [key, req] of Object.entries(requestMap)) {
		const method = req.method ? req.method : key;
		let type;
		if (req.kind === "notification") {
			type = new NotificationType(method, req.params);
		} else {
			type = new RequestType(method, req.params, req.result, req.error);
		}
		result[key] = type;
	}
	return result;
}

export interface RequestHandlerInfo<TError, TCounterPart, TContext = never> {
	newErr(error: ErrorResult<TError>): ErrorWrapper<TError>;
	context: TContext;
	requestId: RequestId;
	counterPart: TCounterPart;
}

export interface NotificationHandlerInfo<TCounterPart, TContext = never> {
	context: TContext;
	counterPart: TCounterPart;
}

export abstract class AbstractContract<
	TTags extends string,
	TContractObject extends ContractObject
> {
	protected onlyDesignTime() {
		return new Error(
			"This property is not allowed to be accessed at runtime"
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
		myInterface: Record<string, any>,
		context: TContext
	): Record<string, unknown> {
		const counterPart: Record<string, unknown> = {};
		for (const [key, req] of Object.entries(otherContract)) {
			let method;
			if (req.kind === "request") {
				method = (args: any) => {
					return typedChannel.request(req, args);
				};
			} else {
				method = (args: any) => {
					return typedChannel.notify(req, args);
				};
			}

			counterPart[key] = method;
		}

		const notificationInfo: NotificationHandlerInfo<any, TContext> = {
			context,
			counterPart,
		};

		for (const [key, req] of Object.entries(myContract)) {
			if (req.kind === "request") {
				const method = myInterface[key];
				if (!method) {
					throw new Error(`No handler for "${key}" given!`);
				}
				typedChannel.registerRequestHandler(
					req,
					async (args, requestId) => {
						try {
							const requestInfo: RequestHandlerInfo<
								any,
								any,
								TContext
							> = {
								context,
								counterPart,
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
					}
				);
			} else {
				const method = myInterface[key];
				if (method) {
					typedChannel.registerNotificationHandler(req, args => {
						// TODO maybe await and log errors?
						method(args, notificationInfo);
					});
				}
			}
		}

		return counterPart;
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

	public getServer(
		typedChannel: TypedChannel,
		clientImplementation: this["TClientHandler"]
	): ContractInterfaceOf<TContractObject["server"]> {
		return this.getInterface(
			typedChannel,
			this.client,
			this.server,
			clientImplementation,
			undefined
		) as any;
	}

	public registerServer(
		typedChannel: TypedChannel,
		serverImplementation: this["TServerHandler"]
	): ContractInterfaceOf<TContractObject["client"]> {
		return this.getInterface(
			typedChannel,
			this.server,
			this.client,
			serverImplementation,
			undefined
		) as any;
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
	): ContractInterfaceOf<TContractObject["server"]> {
		return this.getInterface(
			typedChannel,
			this.client,
			this.server,
			clientImplementation,
			context
		) as any;
	}

	public registerServer(
		typedChannel: TypedChannel,
		context: TContext,
		serverImplementation: this["TServerHandler"]
	): ContractInterfaceOf<TContractObject["client"]> {
		return this.getInterface(
			typedChannel,
			this.server,
			this.client,
			serverImplementation,
			context
		) as any;
	}
}
