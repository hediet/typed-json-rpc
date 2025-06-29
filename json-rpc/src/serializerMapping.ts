import { ISerializer } from "./schema";

declare global {
    interface JsonRpcSerializerMapper<T> {
        zod(val: T): T extends ({ parse: any, safeParse: any }) ? ISerializer<ReturnType<T['parse']>> : undefined;
        serializer(val: T): T extends ISerializer<any> ? T : undefined;
    }
}
