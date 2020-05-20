/*import { contract } from "./TypedChannelContracts";
import { TypedChannel, requestType } from "./TypedChannel";
import {
	sArrayOf,
	sObject,
	sString,
	sTypePackage,
	sTypeDef,
	sNumber,
	TypeSystem,
	sUnion,
	sLiteral,
} from "@hediet/semantic-json";

const sNotificationOrRequest = sUnion(
	sObject({
		kind: sLiteral("notification"),
		method: sString,
		paramsType: sTypeDef,
	}),
	sObject({
		kind: sLiteral("request"),
		method: sString,
		paramsType: sTypeDef,
		resultType: sTypeDef,
		errorType: sTypeDef,
	})
);

export const reflectContract = contract({
	name: "reflectContract",
	server: {
		supportedVersions: requestType({
			method: "reflector/supported-versions",
			result: sObject({
				versions: sArrayOf(sNumber),
			}),
		}),
		list: requestType({
			method:
				"reflector/v1/list-registered-request-and-notification-types",
			result: sObject({
				methods: sArrayOf(sNotificationOrRequest),
				typePackages: sArrayOf(sTypePackage),
			}),
		}),
	},
	client: {},
});

export function registerReflector(channel: TypedChannel) {
	reflectContract.registerServer(channel, {
		supportedVersions: async (args) => {
			return { versions: [1] };
		},
		list: async (args) => {
			const ts = new TypeSystem();
			const methods = channel
				.getRegisteredTypes()
				.map<typeof sNotificationOrRequest["T"]>((t) => {
					const paramsType = t.paramsSerializer.getType(ts);
					if (t.kind === "notification") {
						return {
							kind: t.kind,
							method: t.method,
							paramsType: paramsType.toTypeDef(),
						};
					} else {
						return {
							kind: t.kind,
							method: t.method,
							paramsType: paramsType.toTypeDef(),
							resultType: t.resultSerializer
								.getType(ts)
								.toTypeDef(),
							errorType: t.errorSerializer
								.getType(ts)
								.toTypeDef(),
						};
					}
				});
			return {
				methods,
				typePackages: ts.getDefinedPackages(),
			};
		},
	});
}
*/

export const x = 1;
