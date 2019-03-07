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
import { ErrorCode, ErrorObject } from "./JsonRpcTypes";

type AnyRequestContract = RequestContract<any, any, any>;

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
	TParams extends CouldNotInfer | t.Props,
	TResult extends CouldNotInfer | RuntimeJsonType<any>,
	TError extends CouldNotInfer | RuntimeJsonType<any>
>(request: {
	method?: string;
	params?: TParams;
	result?: TResult;
	error?: TError;
}): RequestContract<
	CouldNotBeInferred<TParams, {}, t.TypeC<AsType<TParams, t.Props>>["_A"]>,
	CouldNotBeInferred<
		TResult,
		void,
		AsType<TResult, RuntimeJsonType<any>>["_A"]
	>,
	CouldNotBeInferred<TError, void, AsType<TError, RuntimeJsonType<any>>["_A"]>
> &
	HasMethod {
	return {
		kind: "request",
		method: request.method,
		params: (request.params
			? t.type(request.params as t.Props)
			: t.type({})) as any,
		error: (request.error ? request.error : voidType) as any,
		result: (request.result ? request.result : voidType) as any,
	};
}

export function notificationContract<
	TParams extends CouldNotInfer | t.Props
>(notification: {
	method?: string;
	params?: TParams;
}): NotificationContract<
	CouldNotBeInferred<TParams, {}, t.TypeC<AsType<TParams, t.Props>>["_A"]>
> &
	HasMethod {
	return {
		kind: "notification",
		method: notification.method,
		params: (notification.params
			? t.type(notification.params as t.Props)
			: t.type({})) as any,
	};
}

export type OneSideContract<TExtra = {}> = Record<
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

export class ErrorWrapper<TError> {
	public static factory: ErrorConstructor<any> = error =>
		new ErrorWrapper(error);
	constructor(public readonly error: ErrorResult<TError>) {}
}

export type ErrorConstructor<TError> = (
	error: ErrorResult<TError>
) => ErrorWrapper<TError>;

export type ContractHandlerOf<TRequestMap extends OneSideContract> = {
	[TKey in RequestKeys<
		TRequestMap
	>]: TRequestMap[TKey] extends AnyRequestContract
		? (
				arg: TRequestMap[TKey]["params"]["_A"],
				err: ErrorConstructor<TRequestMap[TKey]["error"]["_A"]>
		  ) => Promise<
				| TRequestMap[TKey]["result"]["_A"]
				| ErrorWrapper<TRequestMap[TKey]["error"]["_A"]>
		  >
		: never // cannot happen
} &
	{
		[TKey in NotificationKeys<TRequestMap>]?: (
			arg: TRequestMap[TKey]["params"]["_A"]
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

export class Contract<
	TTags extends string,
	TContractObject extends ContractObject
> {
	public get TContractObject(): TContractObject {
		throw new Error(
			"This property is not allowed to be accessed at runtime"
		);
	}

	public get TClientInterface(): ContractInterfaceOf<
		TContractObject["client"]
	> {
		throw new Error("Only for typeof!");
	}

	public get TServerInterface(): ContractInterfaceOf<
		TContractObject["server"]
	> {
		throw new Error("Only for typeof!");
	}

	constructor(
		public readonly tags: TTags[] = [],
		public readonly server: ContractToRequest<TContractObject["server"]>,
		public readonly client: ContractToRequest<TContractObject["client"]>
	) {}

	public registerClientAndGetServer(
		typedChannel: TypedChannel,
		clientInterface: ContractHandlerOf<TContractObject["client"]>
	): ContractInterfaceOf<TContractObject["server"]> {
		return this.getInterface(
			typedChannel,
			this.client,
			this.server,
			clientInterface
		) as any;
	}

	public registerServerAndGetClient(
		typedChannel: TypedChannel,
		serverInterface: ContractHandlerOf<TContractObject["server"]>
	): ContractInterfaceOf<TContractObject["client"]> {
		return this.getInterface(
			typedChannel,
			this.server,
			this.client,
			serverInterface
		) as any;
	}

	private getInterface(
		typedChannel: TypedChannel,
		myContract: Record<
			string,
			NotificationType<any> | RequestType<any, any, any>
		>,
		otherContract: Record<
			string,
			NotificationType<any> | RequestType<any, any, any>
		>,
		myInterface: Record<string, any>
	): Record<string, unknown> {
		for (const [key, req] of Object.entries(myContract)) {
			if (req.kind === "request") {
				const method = myInterface[key];
				typedChannel.registerRequestHandler(req, async args => {
					const result = await method(args, ErrorWrapper.factory);
					if (result instanceof ErrorWrapper) {
						return result.error;
					}

					return { ok: result };
					/*try {
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
					}*/
				});
			} else {
				const method = myInterface[key];
				typedChannel.registerNotificationHandler(req, args => {
					method(args);
				});
			}
		}

		const api: Record<string, unknown> = {};
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

			api[key] = method;
		}
		return api;
	}
}
