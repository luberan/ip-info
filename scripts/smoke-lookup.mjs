import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare, Response } from "miniflare";

const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const bundle = readFileSync(new URL("../.wrangler/build/index.js", import.meta.url), "utf8");
const fixtures = {
  ipv4: { ip: "8.8.8.8", ptr: "8.8.8.8.in-addr.arpa", hostname: "v4.example.net", asn: "AS64500" },
  ipv6: {
    ip: "2001:4860:4860::8888", hostname: "v6.example.net", asn: "AS64501",
    ptr: [..."20014860486000000000000000008888"].reverse().join(".") + ".ip6.arpa",
  },
};
const token = "local-smoke-test";
/** @type {string[]} */
const calls = [];
let ipinfoUnavailable = false;

// Every Worker subrequest is handled locally, including unexpected destinations.
const runtime = new Miniflare({
  cf: false,
  workers: [{
    config: {
      name: config.name,
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags,
      manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bundle } } },
      env: { IPINFO_TOKEN: { type: "text", value: token } },
    },
    dev: {
      outboundService: {
        type: "fetcher",
        /** @param {import("miniflare").Request} request */
        handler(request) {
          const url = new URL(request.url);
          calls.push(url.href);
          assert.equal(request.method, "GET");
          for (const fixture of Object.values(fixtures)) {
            if (url.href === ipinfoUrl(fixture.ip)) {
              assert.equal(request.headers.get("Authorization"), `Bearer ${token}`);
              return ipinfoUnavailable
                ? new Response(null, { status: 503 })
                : Response.json({ ip: fixture.ip, asn: fixture.asn });
            }
            if (url.href === dnsUrl(fixture.ptr)) {
              assert.equal(request.headers.get("Authorization"), null);
              assert.equal(request.headers.get("Accept"), "application/dns-json");
              return Response.json({
                Status: 0, Question: [{ name: fixture.ptr, type: 12 }],
                Answer: [{ name: fixture.ptr, type: 12, data: fixture.hostname + "." }],
              }, { headers: { "Content-Type": "application/dns-json" } });
            }
          }
          throw new Error("Unexpected lookup destination");
        },
      },
    },
  }],
});

/** @param {string} ip */
function ipinfoUrl(ip) { return `https://api.ipinfo.io/lite/${encodeURIComponent(ip)}`; }

/** @param {string} ptr */
function dnsUrl(ptr) { return `https://cloudflare-dns.com/dns-query?name=${ptr}&type=PTR`; }

/** @param {{ipv4?: string, ipv6?: string}} body */
async function lookup(body) {
  const response = await runtime.dispatchFetch("https://example.test/api/lookup", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://example.test" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const content = await response.text();
  assert.ok(!content.includes(token));
  return JSON.parse(content);
}

try {
  const result = await lookup({ ipv4: fixtures.ipv4.ip, ipv6: fixtures.ipv6.ip });
  for (const [family, fixture] of Object.entries(fixtures)) {
    const row = result[family];
    assert.equal(row.ip, fixture.ip);
    assert.equal(row.family, family);
    assert.equal(row.network.status, "ok");
    assert.equal(row.network.source, "ipinfo");
    assert.equal(row.network.data.asn, fixture.asn);
    assert.deepEqual(row.reverseDns, { status: "ok", names: [fixture.hostname], reason: null });
  }
  assert.deepEqual(calls.sort(), Object.values(fixtures).flatMap(({ ip, ptr }) => [ipinfoUrl(ip), dnsUrl(ptr)]).sort());
  console.log("PASS dual-stack lookup through the deployment bundle");

  ipinfoUnavailable = true;
  calls.length = 0;
  const partial = await lookup({ ipv4: fixtures.ipv4.ip });
  assert.equal(partial.ipv6, null);
  assert.deepEqual(partial.ipv4.network, { status: "error", source: "ipinfo", data: null, reason: "http_error" });
  assert.deepEqual(partial.ipv4.reverseDns, result.ipv4.reverseDns);
  assert.deepEqual(calls.sort(), [ipinfoUrl(fixtures.ipv4.ip), dnsUrl(fixtures.ipv4.ptr)].sort());
  console.log("PASS reverse DNS survives an IPinfo outage");
} finally {
  await runtime.dispose();
}
