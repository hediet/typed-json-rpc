import * as webpack from "webpack";
import path = require("path");
import HtmlWebpackPlugin = require("html-webpack-plugin");

const r = (file: string) => path.resolve(__dirname, file);

module.exports = {
	entry: {
		demo1: r("./src/demo1-webworker.ts"),
		demo2: r("./src/demo2-iframe.ts"),
	},
	output: { path: r("dist") },
	resolve: {
		extensions: [".webpack.js", ".web.js", ".ts", ".tsx", ".js"],
	},
	devtool: "source-map",
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				loader: "ts-loader",
				options: { transpileOnly: true },
			},
		],
	},
	plugins: [
		new HtmlWebpackPlugin({ chunks: ["demo1"], filename: "demo1.html" }),
		new HtmlWebpackPlugin({ chunks: ["demo2"], filename: "demo2.html" }),
	],
} as webpack.Configuration;
