import {
    contract,
    types as t,
    requestContract,
    notificationContract,
    StreamBasedChannel,
    TypedChannel,
    StreamLogger,
    MessageStream,
    ConsoleRpcLogger,
    OneSideContract,
    RequestContract,
    ContractObject,
    Contract,
    NotificationContract
} from "@hediet/typed-json-rpc";
import { WebSocketStream } from "@hediet/typed-json-rpc-websocket";
import { startServer } from "@hediet/typed-json-rpc-websocket-server";
import * as winston from "winston";

const logger2 = winston.createLogger({
    transports: [new winston.transports.Console({})]
});

const c = contract({
    server: {
        sendMessage: requestContract({ params: { msg: t.string } })
    },
    client: {
        onNewMessage: notificationContract({ params: { msg: t.string } })
    }
});

const clients = new Set<typeof c.TClientInterface>();

const logger = new ConsoleRpcLogger();

startServer({ port: 12345 }, logger, channel => {
    logger2.info("client");
    const client = c.getClientInterface(channel, {
        sendMessage: async args => {
            console.log(args.msg);
            for (const c of clients) {
                c.onNewMessage({ msg: args.msg });
            }
        }
    });
    clients.add(client);

    channel.startListen();
});

async function foo() {
    const channel = TypedChannel.fromStream(
        new StreamLogger(
            await WebSocketStream.connectTo({ address: "ws://localhost:12345" })
        ),
        logger
    );
    const server = c.getServerInterface(channel, {
        onNewMessage: args => logger2.info("onNewMessage: ", args.msg)
    });
    channel.startListen();

    server.sendMessage({ msg: "hellow world" });
}

foo();
