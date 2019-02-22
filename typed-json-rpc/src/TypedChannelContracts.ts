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
    RuntimeJsonTypeArrOrObj
} from "./TypedChannel";

type AnyRequestContract = RequestContract<any, any, any>;

export interface RequestContract<
    TParams = unknown,
    TResult = unknown,
    TError = unknown
> {
    kind: "request";
    method: string | undefined;
    params: RuntimeJsonTypeArrOrObj<TParams>;
    result: RuntimeJsonType<TResult>;
    error: RuntimeJsonType<TError>;
}

export interface NotificationContract<TArgs = unknown> {
    kind: "notification";
    method: string | undefined;
    params: RuntimeJsonTypeArrOrObj<TArgs>;
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
> {
    return {
        kind: "request",
        method: request.method,
        params: (request.params
            ? t.type(request.params as t.Props)
            : t.type({})) as any,
        error: (request.error ? request.error : voidType) as any,
        result: (request.result ? request.result : voidType) as any
    };
}

export function notificationContract<
    TParams extends CouldNotInfer | t.Props
>(notification: {
    method?: string;
    params?: TParams;
}): NotificationContract<
    CouldNotBeInferred<TParams, {}, t.TypeC<AsType<TParams, t.Props>>["_A"]>
> {
    return {
        kind: "notification",
        method: notification.method,
        params: (notification.params
            ? t.type(notification.params as t.Props)
            : t.type({})) as any
    };
}

export type OneSideContract = Record<
    string,
    AnyRequestContract | NotificationContract<any>
>;

export interface ContractObject {
    server: OneSideContract;
    client: OneSideContract;
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

export type ContractHandlerOf<TRequestMap extends OneSideContract> = {
    [TKey in RequestKeys<TRequestMap>]: (
        arg: TRequestMap[TKey]["params"]["_A"]
    ) => TRequestMap[TKey] extends AnyRequestContract
        ? Promise<TRequestMap[TKey]["result"]["_A"]>
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

export function contract<TContractObject extends ContractObject>(
    contractObj: TContractObject
): Contract<string, TContractObject>;
export function contract<
    TTags extends string,
    TContractObject extends ContractObject
>(
    tags: TTags[],
    contractObj: TContractObject
): Contract<TTags, TContractObject>;
export function contract<TContractObject extends ContractObject>(
    contractObj: TContractObject
): Contract<string, TContractObject> {
    return new (Contract as any)(contractObj);
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

    public readonly server: ContractToRequest<TContractObject["server"]>;
    public readonly client: ContractToRequest<TContractObject["client"]>;

    private constructor(
        public readonly tags: TTags[] = [],
        contract: TContractObject
    ) {
        this.server = this.transform(contract.server) as any;
        this.client = this.transform(contract.client) as any;
    }

    private transform(
        requestMap: OneSideContract
    ): Record<string, NotificationType | RequestType> {
        const result: Record<string, NotificationType | RequestType> = {};
        for (const [key, req] of Object.entries(requestMap)) {
            const method = req.method ? req.method : key;
            let type;
            if (req.kind === "notification") {
                type = new NotificationType(method, req.params);
            } else {
                type = new RequestType(
                    method,
                    req.params,
                    req.result,
                    req.error
                );
            }
            result[key] = type;
        }
        return result;
    }

    public getServerInterface(
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

    public getClientInterface(
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
                    return { result: await method(args) };
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
