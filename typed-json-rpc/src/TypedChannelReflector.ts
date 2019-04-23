import { TypedChannel, contract, requestContract } from ".";
import * as t from "io-ts";

export const reflectContract = contract({
	server: {
		list: requestContract({
			method: "reflector/list-registered-request-and-notification-types",
			result: t.array(
				t.type({
					method: t.string,
				})
			),
		}),
	},
	client: {},
});

export function registerReflector(channel: TypedChannel) {
	reflectContract.registerServer(channel, {
		list: async args => {
			channel.getRegisteredTypes().map(t => {});
			return [];
		},
	});
}
