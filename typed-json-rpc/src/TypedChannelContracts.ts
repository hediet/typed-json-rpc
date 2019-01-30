import * as t from "io-ts";
import { RequestType, NotificationType, TypedChannel } from "./TypedChannel";

type AnyRequestContract = RequestContract<any, any, any>;

export interface RequestContract<TArgs = unknown, TResponse = unknown, TError = unknown> {
    kind: "request";
    method: string|undefined;
    params: t.Type<TArgs>;
    result: t.Type<TResponse>;
    error: t.Type<TError>;
}

export interface NotificationContract<TArgs = unknown> {
    kind: "notification";
    method: string|undefined;
    params: t.Type<TArgs>;
}

interface CouldNotInfer {
    __unsetMarker: "Unset-Marker";
}

type CouldNotBeInferred<T, TTrue, TFalse> = CouldNotInfer extends T ? TTrue : TFalse;
type AsType<T, T2> = T extends T2 ? T : never;

export const voidType = new t.Type<void, null, null>(
    "void",
    (u: unknown): u is void => u === undefined,
    (i: unknown, context: t.Context) => {
        if (i === null) { return t.success(undefined); }
        return t.failure(i, context, "Given value is not 'null'.");
    },
    (_u: void) => null
);

export function requestContract
    <TRequest extends CouldNotInfer|t.Props, TResponse extends CouldNotInfer|t.Type<any>, TError extends CouldNotInfer|t.Type<any>>
    (request: { method?: string; params?: TRequest, result?: TResponse, error?: TError })
    : RequestContract<
        CouldNotBeInferred<TRequest, {}, t.TypeC<AsType<TRequest, t.Props>>["_A"]>,
        CouldNotBeInferred<TResponse, void, AsType<TResponse, t.Type<any>>["_A"]>,
        CouldNotBeInferred<TError, void, AsType<TError, t.Type<any>>["_A"]>
    > {
        return {
            kind: "request",
            method: request.method,
            params: (request.params ? t.type(request.params as t.Props) : t.type({})) as any,
            error: (request.error ? request.error : voidType) as any,
            result: (request.result ? request.result : voidType) as any,
        }
}

export function notificationContract
    <TRequest extends CouldNotInfer|t.Props>
    (notification: { method?: string; params?: TRequest })
    : NotificationContract<
        CouldNotBeInferred<TRequest, {}, t.TypeC<AsType<TRequest, t.Props>>["_A"]>
    > {
        return {
            kind: "notification",
            method: notification.method,
            params: (notification.params ? t.type(notification.params as t.Props) : t.type({})) as any
        }
}

export type OneSideContract = Record<string, AnyRequestContract | NotificationContract<any>>;

export interface ContractObject {
    server: OneSideContract;
    client: OneSideContract;
}

export type ContractToRequest<TRequestMap extends OneSideContract> = {
    [TRequest in keyof TRequestMap]:
        TRequestMap[TRequest] extends AnyRequestContract
            ? RequestType<TRequestMap[TRequest]["params"]["_A"], TRequestMap[TRequest]["result"]["_A"], TRequestMap[TRequest]["error"]["_A"]>
            : NotificationType<TRequestMap[TRequest]["params"]["_A"]>
};

export type ContractInterfaceOf<TRequestMap extends OneSideContract> = {
    [TRequest in keyof TRequestMap]:
        TRequestMap[TRequest] extends AnyRequestContract
            ? (arg: TRequestMap[TRequest]["params"]["_A"]) => Promise<TRequestMap[TRequest]["result"]["_A"]>
            : (arg: TRequestMap[TRequest]["params"]["_A"]) => void
};

export type ContractHandlerOf<TRequestMap extends OneSideContract> =
    {
        [TKey in RequestKeys<TRequestMap>]:
            (arg: TRequestMap[TKey]["params"]["_A"]) =>
                TRequestMap[TKey] extends AnyRequestContract
                    ? Promise<TRequestMap[TKey]["result"]["_A"]>
                    : never // cannot happen
    }
    & {
        [TKey in NotificationKeys<TRequestMap>]?:
            (arg: TRequestMap[TKey]["params"]["_A"]) => void
    };

export type RequestKeys<TRequestMap extends OneSideContract> = {
    [TRequest in keyof TRequestMap]:
        TRequestMap[TRequest] extends AnyRequestContract
            ? TRequest : never
}[keyof TRequestMap];

export type NotificationKeys<TRequestMap extends OneSideContract> = {
    [TRequest in keyof TRequestMap]:
        TRequestMap[TRequest] extends AnyRequestContract
            ? never : TRequest
}[keyof TRequestMap];

export function contract<TContractObject extends ContractObject>(contractObj: TContractObject): Contract<TContractObject> {
    return new (Contract as any)(contractObj);
}

export class Contract<TContractObject extends ContractObject> {
    public readonly server: ContractToRequest<TContractObject["server"]>;
    public readonly client: ContractToRequest<TContractObject["client"]>;

    private constructor(contract: TContractObject) {
        this.server = this.transform(contract.server) as any;
        this.client = this.transform(contract.client) as any;
    }

    private transform(requestMap: OneSideContract): Record<string, NotificationType | RequestType> {
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

    public get _clientInterface(): ContractInterfaceOf<TContractObject["client"]> {
        throw new Error("Only for typeof!");
    }

    public get _serverInterface(): ContractInterfaceOf<TContractObject["server"]> {
        throw new Error("Only for typeof!");
    }

    public getServerInterface(typedChannel: TypedChannel, clientInterface: ContractHandlerOf<TContractObject["client"]>): ContractInterfaceOf<TContractObject["server"]> {
        return this.getInterface(typedChannel, this.client, this.server, clientInterface) as any;
    }

    public getClientInterface(typedChannel: TypedChannel, serverInterface: ContractHandlerOf<TContractObject["server"]>): ContractInterfaceOf<TContractObject["client"]> {
        return this.getInterface(typedChannel, this.server, this.client, serverInterface) as any;
    }

    private getInterface(
        typedChannel: TypedChannel,
        myContract: Record<string, NotificationType<any>|RequestType<any, any, any>>,
        otherContract: Record<string, NotificationType<any>|RequestType<any, any, any>>,
        myInterface: Record<string, any>,
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
