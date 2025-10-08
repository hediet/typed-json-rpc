import { ISerializer } from "../schema";

const _x: ISerializer<any> = null!; // keep the import

declare global {
    // Used to extend JsonRpcSerializerMapperLocal.
    interface JsonRpcSerializerMapper<T> {
    }
}
