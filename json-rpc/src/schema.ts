import type { z } from 'zod';

export namespace Serializers {
    export function sAny(): ISerializer<any> {
        return {
            deserializeFromJson: input => ({ hasErrors: false, value: input }),
            serializeToJson: input => input,
        }
    }
    export function sEmptyObject(): ISerializer<{}> {
        return {
            deserializeFromJson: input => ({ hasErrors: false, value: {} }),
            serializeToJson: input => ({}),
        };
    }

    export function sVoidFromNull(): ISerializer<void> {
        return {
            deserializeFromJson: input => ({ hasErrors: false, value: undefined }),
            serializeToJson: input => null,
        };
    }
}

interface JsonRpcSerializerMapperLocal<T> extends JsonRpcSerializerMapper<T> {
    zod(val: T): T extends ({ parse: any, safeParse: any }) ? ISerializer<ReturnType<T['parse']>> : undefined;
    serializer(val: T): T extends ISerializer<any> ? T : undefined;
}

let globalMapper: Partial<JsonRpcSerializerMapperLocal<any>> = {
    serializer: val => {
        if (!isSerializer(val)) {
            return undefined;
        }
        return val;

    },
    zod: val => {
        if (!isZodType(val)) {
            return undefined;
        }
        return {
            serializeToJson: input => val.parse(input),
            deserializeFromJson: input => {
                const result = val.safeParse(input);
                if (result.success) {
                    return { hasErrors: false, value: result.data };
                } else {
                    return { hasErrors: true, value: undefined, errorMessage: result.error.message };
                }
            }
        } as ISerializer<any>;
    }
};

function isZodType(val: any): val is z.ZodType {
    return 'parse' in val && 'safeParse' in val;
}

function isSerializer(val: any): val is ISerializer<any> {
    return 'serializeToJson' in val && 'deserializeFromJson' in val;
}

export function setMapper(mapper: Partial<JsonRpcSerializerMapperLocal<any>>): void {
    Object.assign(globalMapper, mapper);
}

export type UnionValue<T> = T[keyof T];
export type RemoveUndefined<T> = T extends undefined ? never : T;

export type SerializerOf<T> = RemoveUndefined<UnionValue<{ [TKey in keyof JsonRpcSerializerMapperLocal<any>]: ReturnType<JsonRpcSerializerMapperLocal<T>[TKey]> }>>;

export type SerializerTAny<T> = SerializerOf<T> extends never ? 'Error:UnknownSerializer' : SerializerOf<T> extends ISerializer<infer U> ? U : never;

export type SerializerT<T extends ISerializer<any>> = T extends ISerializer<infer U> ? U : never;

export function convertSerializer<T>(val: T): SerializerOf<T> {
    for (const [key, value] of Object.entries(globalMapper)) {
        const result = value(val);
        if (result) {
            return result as SerializerOf<T>;
        }
    }
    throw new Error(`No serializer found for value: ${val}`);
}


export interface ISerializer<T> {
    serializeToJson(input: T): JSONValue;
    deserializeFromJson(input: JSONValue): DeserializationResult<T>;
};

export type DeserializationResult<T> = {
    hasErrors: false;
    value: T;
} | {
    hasErrors: true;
    value: undefined;
    errorMessage: string;
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
