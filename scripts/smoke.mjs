import assert from "node:assert/strict";
import { request } from "node:http";
import { text } from "node:stream/consumers";
import { createTestHarness } from "wrangler";

const server = createTestHarness({
  workers: [{
    configPath: new URL("../wrangler.jsonc", import.meta.url),
    secrets: { IPINFO_TOKEN: "" },
  }],
});

/** @type {Array<{ path: string, status: number, api: boolean, mime: RegExp, navigate?: boolean, method?: string, body?: string | Uint8Array, contentType?: string, origin?: string, error?: string, text?: string }>} */
const checks = [
  { path: "/", status: 200, api: false, mime: /^text\/html/, navigate: true, text: '<html lang="en">' },
  { path: "/app.js", status: 200, api: false, mime: /^(text|application)\/javascript/ },
  { path: "/styles.css", status: 200, api: false, mime: /^text\/css/ },
  { path: "/favicon.svg", status: 200, api: false, mime: /^image\/svg\+xml/ },
  { path: "/missing-page", status: 404, api: false, mime: /^text\/html/, text: "Page not found." },
  { path: "/missing-page", status: 404, api: false, mime: /^text\/html/, navigate: true, text: "Page not found." },
  { path: "/api", status: 404, api: true, mime: /^application\/json/, navigate: true, error: "not_found" },
  { path: "/api/", status: 404, api: true, mime: /^application\/json/, error: "not_found" },
  { path: "/api/connection", status: 200, api: true, mime: /^application\/json/ },
  { path: "/api/connection", status: 200, api: true, mime: /^application\/json/, navigate: true },
  { path: "/api/connection", method: "POST", status: 405, api: true, mime: /^application\/json/, error: "method_not_allowed" },
  { path: "/api/lookup", status: 405, api: true, mime: /^application\/json/, error: "method_not_allowed" },
  {
    path: "/api/lookup", method: "POST", status: 400, api: true, mime: /^application\/json/,
    contentType: "application/json", body: '{"ipv4":"127.0.0.1"}', error: "invalid_ip",
  },
  {
    path: "/api/lookup", method: "POST", status: 400, api: true, mime: /^application\/json/,
    contentType: "application/json", body: Uint8Array.of(0xff), error: "invalid_encoding",
  },
  {
    path: "/api/lookup", method: "POST", status: 415, api: true, mime: /^application\/json/,
    contentType: "text/plain", body: "{}", error: "unsupported_media_type",
  },
  {
    path: "/api/lookup", method: "POST", status: 413, api: true, mime: /^application\/json/,
    contentType: "application/json", body: " ".repeat(1_025), error: "body_too_large",
  },
  {
    path: "/api/lookup", method: "POST", status: 403, api: true, mime: /^application\/json/,
    contentType: "application/json", body: "{}", origin: "https://untrusted.example", error: "cross_origin_denied",
  },
  { path: "/api/missing", status: 404, api: true, mime: /^application\/json/, error: "not_found" },
];

/** @type {ReturnType<typeof setTimeout> | undefined} */
let timer;

try {
  const { url } = await Promise.race([
    server.listen(),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Workers runtime did not start within 45 seconds.")), 45_000);
    }),
  ]);
  clearTimeout(timer);

  for (const check of checks) {
    // Node fetch sets Sec-Fetch-Mode itself. Send navigation requests as a browser would.
    /** @type {Record<string, string>} */
    const headers = { "Sec-Fetch-Mode": check.navigate ? "navigate" : "cors" };
    if (check.navigate) headers.Accept = "text/html";
    if (check.contentType) headers["Content-Type"] = check.contentType;
    if (check.origin) headers.Origin = check.origin;
    /** @type {import("node:http").IncomingMessage} */
    const response = await new Promise((resolve, reject) => {
      const req = request(new URL(check.path, url), {
        method: check.method ?? "GET", headers, signal: AbortSignal.timeout(5_000),
      }, resolve);
      req.on("error", reject);
      req.end(check.body);
    });
    const content = await text(response);
    const label = `${check.method ?? "GET"} ${check.path}${check.navigate ? " (navigation)" : ""}`;
    assert.equal(response.statusCode, check.status, `${label}: unexpected status`);
    assert.match(response.headers["content-type"] ?? "", check.mime, `${label}: incorrect content type`);
    assert.equal(response.headers["x-content-type-options"], "nosniff", `${label}: missing nosniff`);

    if (check.api) {
      for (const name of ["Cache-Control", "CDN-Cache-Control", "Cloudflare-CDN-Cache-Control"]) {
        assert.equal(response.headers[name.toLowerCase()], "no-store", `${label}: missing ${name}`);
      }
      const body = JSON.parse(content);
      if (check.error) assert.equal(body.error?.code, check.error, `${label}: incorrect error code`);
      else {
        assert.ok(Object.hasOwn(body, "ip"), `${label}: missing observed address field`);
        assert.ok(body.metadata && typeof body.metadata === "object", `${label}: missing connection metadata`);
      }
    } else {
      assert.notEqual(response.headers["cache-control"], "no-store", `${label}: static route invoked the API`);
      if (check.text) assert.ok(content.includes(check.text), `${label}: unexpected page content`);
    }
    console.log(`PASS ${label} (${check.status})`);
  }
  console.log(`Workers runtime smoke test passed (${checks.length} requests; no external API calls).`);
} finally {
  clearTimeout(timer);
  await server.close();
}
