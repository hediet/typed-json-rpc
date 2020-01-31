import {
	contract,
	requestContract,
	notificationContract,
} from "@hediet/json-rpc";
import * as t from "io-ts";

/*
export const app = contract({
    server: {
        copy: requestContract({
            description: "copies a file",
            params: obj({
                file: field({
                    type: filePath,
                    description: "The file path",
                    [cli]: { short: "f" }
                }),
                dir: field({ type: dirPath })
            })
        })
    },
    client: {
        fileExists: requestContract({})
    }
});

app.server.copy;

*/
