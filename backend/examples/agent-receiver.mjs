import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const host = "127.0.0.1";
const port = 8765;
const captureDir = path.resolve("captures");

http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method !== "POST" || req.url !== "/screenshot") {
    sendJson(res, 404, { ok: false, error: "Not found" });
    return;
  }

  try {
    const payload = JSON.parse(await readBody(req));
    const image = parseDataUrl(payload.screenshot);
    const name = createCaptureName(payload.metadata?.tab?.url);
    const filePath = path.join(captureDir, name);

    await mkdir(captureDir, { recursive: true });
    await writeFile(filePath, image);

    console.log("Prompt:", payload.prompt || "(empty)");
    console.log("URL:", payload.metadata?.tab?.url || "(unknown)");
    console.log("Saved:", filePath);

    sendJson(res, 200, { ok: true, path: filePath });
  } catch (error) {
    sendJson(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}).listen(port, host, () => {
  console.log(`Listening on http://${host}:${port}/screenshot`);
});

async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }
  return body;
}

function parseDataUrl(value) {
  const match = /^data:image\/png;base64,(.+)$/.exec(value || "");
  if (!match) {
    throw new Error("Expected screenshot to be a PNG data URL.");
  }
  return Buffer.from(match[1], "base64");
}

function createCaptureName(url) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  let hostName = "browser";

  try {
    hostName = new URL(url).hostname || hostName;
  } catch {
    // Keep the fallback name for browser pages without a standard URL.
  }

  return `${timestamp}-${hostName}.png`;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  });
  res.end(status === 204 ? "" : JSON.stringify(payload));
}
