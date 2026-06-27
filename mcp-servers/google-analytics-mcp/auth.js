/**
 * One-time OAuth authorization script.
 *
 * Prerequisites:
 *   1. Download OAuth 2.0 Client ID JSON from Google Cloud Console
 *      (Credentials → Create → OAuth 2.0 Client ID → Desktop app)
 *      and save it as credentials.json in this directory.
 *   2. Run: node auth.js
 *      A browser window opens — sign in as gor@passionateagency.com and Allow.
 *      token.json is saved automatically.
 *
 * You only need to run this once. The MCP server refreshes tokens automatically.
 */

import { google } from "googleapis";
import { readFileSync, writeFileSync } from "fs";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { exec } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_PATH = join(__dirname, "credentials.json");
const TOKEN_PATH = join(__dirname, "token.json");
const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}`;

const SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
];

const creds = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8"));
const { client_id, client_secret } = creds.installed;

const oauth2Client = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent",
});

const server = createServer(async (req, res) => {
  if (!req.url.startsWith("/")) return;
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<html><body><h2>Authorization failed: ${error}</h2><p>Close this window and try again.</p></body></html>`);
    server.close();
    process.exit(1);
  }

  if (code) {
    try {
      const { tokens } = await oauth2Client.getToken(code);
      writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<html><body><h2 style="color:green">✓ Authorization successful!</h2><p>You can close this window and return to the terminal.</p></body></html>`);
      console.log("\n✓ token.json saved — authorization complete.");
      console.log("✓ You can now start the MCP server with: pm2 start google-analytics-mcp.config.cjs\n");
    } catch (err) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<html><body><h2>Error: ${err.message}</h2></body></html>`);
      console.error("Error exchanging code:", err.message);
    }
    server.close();
    process.exit(0);
  }
});

server.listen(PORT, () => {
  console.log("\n=== Google Analytics MCP — One-time Authorization ===\n");
  console.log("Opening browser... If it does not open, paste this URL manually:\n");
  console.log(authUrl + "\n");
  exec(`start "" "${authUrl}"`);
});
