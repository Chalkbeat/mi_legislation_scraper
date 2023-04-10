var fs = require("fs");
var google = require("@googleapis/sheets");
var http = require("http");
var path = require("path");
var os = require("os");
var url = require("url");

var clientID = process.env.GOOGLE_OAUTH_CLIENT_ID;
var secret = process.env.GOOGLE_OAUTH_CONSUMER_SECRET;
var tokenLocation = path.join(os.homedir(), ".google_oauth_token");

var getClient = function() {
  var auth = new google.auth.OAuth2(clientID, secret, "http://localhost:8000/authenticate/");
  var tokens = {};

  try {
    var json = fs.readFileSync(tokenLocation, "utf-8");
    tokens = JSON.parse(json);
    auth.setCredentials(tokens);
  } catch (err) {
    console.log("Unable to load existing tokens");
  }

  auth.on("tokens", function(update) {
    Object.assign(tokens, update);
    fs.writeFileSync(tokenLocation, JSON.stringify(tokens, null, 2));
  });

  return auth;
}

var authenticate = function(permissions = []) {

  return new Promise(function(ok, fail) {

    var client = getClient();
    var scopes = [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/spreadsheets"
    ].concat(permissions);
    var authURL = client.generateAuthUrl({
      access_type: "offline",
      scope: scopes.join(" "),
      prompt: "consent"
    });

    var onRequest = function(request, response) {
      response.setHeader("Connection", "close");
      if (request.url.indexOf("authenticate") > -1) {
        return onAuthenticated(request, response);
      } else if (request.url.indexOf("authorize") > -1) {
        response.setHeader("Location", authURL);
        response.writeHead(302);
      } else {
        response.writeHead(404);
      }
      response.end();
    };

    var onAuthenticated = async function(request, response) {
      var requestURL = request.url[0] == "/" ? "localhost:8000" + request.url : request.url;
      var query = new url.URL(requestURL).searchParams;
      var code = query.get("code");
      if (!code) return;
      try {
        var token = await client.getToken(code);
        var tokens = token.tokens;
        fs.writeFileSync(tokenLocation, JSON.stringify(tokens, null, 2));
        response.end("Authenticated, saving token to your home directory.");
        server.close(function(err) {
          server.unref();
          process.nextTick(ok);
        });
      } catch (err) {
        response.end(err.message);
        return fail(err);
      }
    };

    var server = http.createServer(onRequest);
    server.listen(8000, () => console.log("Authorize via http://localhost:8000/authorize"));

  });
};

module.exports = { authenticate, getClient }