import assert from "node:assert/strict";
import { createTestHarness } from "wrangler";

const server = createTestHarness({
  workers: [{
    configPath: new URL("../wrangler.jsonc", import.meta.url),
    secrets: { IPINFO_TOKEN: "" },
  }],
});

/** @type {Array<{ path: string, status: number, api: boolean, mime: RegExp, method?: string, body?: string, contentType?: string, origin?: string, error?: string, text?: string }>} */
const checks = [
  { path: "/", status: 200, api: false, mime: /^text\/html/, text: '<html lang="en">' },
  { path: "/app.js", status: 200, api: false, mime: /^(text|application)\/javascript/ },
  { path: "/styles.css", status: 200, api: false, mime: /^text\/css/ },
  { path: "/missing-page", status: 404, api: false, mime: /^text\/html/, text: "Page not found." },
  { path: "/api/connection", status: 200, api: true, mime: /^application\/json/ },
  { path: "/api/connection", method: "POST", status: 405, api: true, mime: /^application\/json/, error: "method_not_allowed" },
  { path: "/api/lookup", status: 405, api: true, mime: /^application\/json/, error: "method_not_allowed" },
  {
    path: "/api/lookup", method: "POST", status: 400, api: true, mime: /^application\/json/,
    contentType: "application/json", body: '{"ipv4":"127.0.0.1"}', error: "invalid_ip",
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
    const headers = new Headers({ "Sec-Fetch-Mode": "cors" });
    if (check.contentType) headers.set("Content-Type", check.contentType);
    if (check.origin) headers.set("Origin", check.origin);
    const response = await fetch(new URL(check.path, url), {
      method: check.method ?? "GET",
      headers,
      body: check.body,
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    const label = `${check.method ?? "GET"} ${check.path}`;
    assert.equal(response.status, check.status, `${label}: unexpected status`);
    assert.match(response.headers.get("Content-Type") ?? "", check.mime, `${label}: incorrect content type`);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff", `${label}: missing nosniff`);

    if (check.api) {
      for (const name of ["Cache-Control", "CDN-Cache-Control", "Cloudflare-CDN-Cache-Control"]) {
        assert.equal(response.headers.get(name), "no-store", `${label}: missing ${name}`);
      }
      const body = await response.json();
      if (check.error) assert.equal(body.error?.code, check.error, `${label}: incorrect error code`);
      else {
        assert.ok(Object.hasOwn(body, "ip"), `${label}: missing observed address field`);
        assert.ok(body.metadata && typeof body.metadata === "object", `${label}: missing connection metadata`);
      }
    } else {
      assert.notEqual(response.headers.get("Cache-Control"), "no-store", `${label}: static route invoked the API`);
      const text = await response.text();
      if (check.text) assert.ok(text.includes(check.text), `${label}: unexpected page content`);
    }
    console.log(`PASS ${label} (${check.status})`);
  }
  console.log(`Workers runtime smoke test passed (${checks.length} requests; no external API calls).`);
} finally {
  clearTimeout(timer);
  await server.close();
}
