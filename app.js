var express = require('express');
var ParseServer = require('parse-server').ParseServer;
var ParseDashboard = require('parse-dashboard');
var server = express();
var fs = require('fs');
var config = process.env;
const port = config.PORT || 8080;

if (config.DEV) {
	try{
		fs.accessSync(".env", fs.R_OK | fs.W_OK);
		require('dotenv').config();

		var dashboard = new ParseDashboard({
			"allowInsecureHTTP": true,
			"apps": [
				{
					"serverURL": config.SERVER_URL,
					"appId": config.APP_ID,
					"masterKey": config.MASTER_KEY,
					"appName": config.APP_NAME
				}
			],
			"users": [
			{
				"user": config.DASHBOARD_USER,
				"pass": config.DASHBOARD_PWD
			}]
		}, true);

		var api = new ParseServer({
			databaseURI: config.MONGO_CONNECTION_URL, // Connection string for your MongoDB database
			cloud: __dirname + config.CLOUD_CODE_URL, // Absolute path to your Cloud Code
			appId: config.APP_ID,
			masterKey: config.MASTER_KEY, // Keep this key secret!
			serverURL: config.SERVER_URL, // Don't forget to change to https if needed
			enableAnonymousUsers: false,
			allowClientClassCreation: false
		});

		server.use(config.ENDPOINT_APP, api);
		server.use(config.DASHBOARD_ENDPOINT, dashboard);

		server.listen(port, function() {
			console.log('parse-server-example running on port ' + port + '.');
		});
	}catch(e){
	  console.log('Error:', e);
	}
} else {
	var dashboard = new ParseDashboard({
		"allowInsecureHTTP": true,
		"apps": [
			{
				"serverURL": config.SERVER_URL,
				"appId": config.APP_ID,
				"masterKey": config.MASTER_KEY,
				"appName": config.APP_NAME
			}
		],
		"users": [
		{
			"user": config.DASHBOARD_USER,
			"pass": config.DASHBOARD_PWD
		}]
	}, true);
	
	var api = new ParseServer({
		databaseURI: config.MONGO_CONNECTION_URL, // Connection string for your MongoDB database
		cloud: __dirname + config.CLOUD_CODE_URL, // Absolute path to your Cloud Code
		appId: config.APP_ID,
		masterKey: config.MASTER_KEY, // Keep this key secret!
		serverURL: config.SERVER_URL, // Don't forget to change to https if needed
		enableAnonymousUsers: false,
		allowClientClassCreation: false
	});

	server.use(config.ENDPOINT_APP, api);
	server.use(config.DASHBOARD_ENDPOINT, dashboard);

	server.listen(port, function() {
		console.log('parse-server-example running on port ' + port + '.');
	});
}