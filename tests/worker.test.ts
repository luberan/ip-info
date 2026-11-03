import { beforeEach, describe, expect, it, vi } from "vitest";
import worker, * as entry from "../src/index";
import { MAX_REQUEST_BYTES } from "../src/lib/http";
import { ptrName } from "../src/lib/ip";
import { dnsResponse, ipinfoResponse, IPV4, IPV6 } from "./fixtures";

const fetchMock = vi.fn<typeof fetch>();

function upstreamResponse(input: RequestInfo | URL): Response {
  const url = new URL(String(input));
  if (url.origin === "https://api.ipinfo.io") {
    const ip = decodeURIComponent(url.pathname.slice("/lite/".length));
    return Response.json(ipinfoResponse(ip));
  }
  if (url.origin === "https://cloudflare-dns.com") {
    return Response.json(dnsResponse(url.searchParams.get("name") ?? ""));
  }
  throw new Error("An unexpected upstream endpoint was used.");
}

function lookupRequest(body: unknown, headers: HeadersInit = {}): Request {
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has("Content-Type")) requestHeaders.set("Content-Type", "application/json");
  return new Request("https://ip.lukasberan.cz/api/lookup", {
    method: "POST", headers: requestHeaders, body: JSON.stringify(body),
  });
}

function withCf(request: Request, cf: Partial<IncomingRequestCfProperties>): Request {
  Object.defineProperty(request, "cf", { value: cf });
  return request;
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => upstreamResponse(input));
  vi.stubGlobal("fetch", fetchMock);
});

describe("GET /api/connection", () => {
  it("handles missing headers and missing request.cf without invented data", async () => {
    const response = await worker.fetch(new Request("https://ip.lukasberan.cz/api/connection"), {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ip: null, family: null, ipSource: null, pseudoIpv4: null, reason: "client_ip_unavailable",
      metadata: {
        asn: null, asOrganization: null, country: null, region: null, city: null,
        timezone: null, colo: null, httpProtocol: null, tlsVersion: null,
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses only the trusted connection header and documented metadata fields", async () => {
    const request = withCf(new Request("https://ip.lukasberan.cz/api/connection", {
      headers: { "CF-Connecting-IP": IPV4, "X-Forwarded-For": "1.1.1.1", "X-Real-IP": "9.9.9.9" },
    }), {
      asn: 15169, asOrganization: "Observed network", country: "CZ", city: "Prague",
      region: "Prague", timezone: "Europe/Prague", colo: "PRG", httpProtocol: "HTTP/2",
      tlsVersion: "TLSv1.3", latitude: "50.0", longitude: "14.0",
    });
    const response = await worker.fetch(request, {});
    expect(await response.json()).toEqual({
      ip: IPV4, family: "ipv4", ipSource: "cf-connecting-ip", pseudoIpv4: null, reason: null,
      metadata: {
        asn: 15169, asOrganization: "Observed network", country: "CZ", city: "Prague",
        region: "Prague", timezone: "Europe/Prague", colo: "PRG", httpProtocol: "HTTP/2", tlsVersion: "TLSv1.3",
      },
    });
  });

  it("restores IPv6 when Cloudflare Pseudo IPv4 overwrites the primary header", async () => {
    const response = await worker.fetch(new Request("https://ip.lukasberan.cz/api/connection", {
      headers: { "CF-Connecting-IP": "240.1.2.3", "CF-Connecting-IPv6": "2001:4860:4860:0:0:0:0:8888" },
    }), {});
    expect(await response.json()).toMatchObject({
      ip: IPV6, family: "ipv6", ipSource: "cf-connecting-ipv6", pseudoIpv4: "240.1.2.3", reason: null,
    });
  });

  it("does not present an unrecoverable Pseudo IPv4 as a real client address", async () => {
    const response = await worker.fetch(new Request("https://ip.lukasberan.cz/api/connection", {
      headers: { "CF-Connecting-IP": "240.1.2.3", "CF-Connecting-IPv6": "invalid" },
    }), {});
    expect(await response.json()).toMatchObject({
      ip: null, family: null, pseudoIpv4: "240.1.2.3", reason: "pseudo_ipv4_without_ipv6",
    });
  });

  it("ignores an unrelated IPv6 header when the actual connection is ordinary IPv4", async () => {
    const response = await worker.fetch(new Request("https://ip.lukasberan.cz/api/connection", {
      headers: { "CF-Connecting-IP": IPV4, "CF-Connecting-IPv6": IPV6 },
    }), {});
    expect(await response.json()).toMatchObject({ ip: IPV4, family: "ipv4", pseudoIpv4: null });
  });

  it("does not trust X-Forwarded-For when CF-Connecting-IP is absent", async () => {
    const response = await worker.fetch(new Request("https://ip.lukasberan.cz/api/connection", {
      headers: { "X-Forwarded-For": IPV4 },
    }), {});
    expect(await response.json()).toMatchObject({ ip: null, family: null });
  });
});

describe("POST /api/lookup", () => {
  it("enriches both families using only fixed authenticated IPinfo and DoH endpoints", async () => {
    const response = await worker.fetch(lookupRequest({ ipv4: IPV4, ipv6: IPV6 }), {
      IPINFO_TOKEN: "unit-test-token",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ipv4: { ip: IPV4, family: "ipv4", network: { status: "ok", source: "ipinfo" }, reverseDns: { status: "ok" } },
      ipv6: { ip: IPV6, family: "ipv6", network: { status: "ok", source: "ipinfo" }, reverseDns: { status: "ok" } },
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [input, init] of fetchMock.mock.calls) {
      const url = new URL(String(input));
      expect(["https://api.ipinfo.io", "https://cloudflare-dns.com"]).toContain(url.origin);
      expect(init?.redirect).toBe("manual");
      expect(url.searchParams.has("token")).toBe(false);
      if (url.origin === "https://api.ipinfo.io") {
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer unit-test-token");
      } else {
        expect(new Headers(init?.headers).has("Authorization")).toBe(false);
      }
    }
  });

  it("starts all four independent subrequests without waiting for the first response", async () => {
    const release: (() => void)[] = [];
    fetchMock.mockImplementation((input) => new Promise<Response>((resolve) => {
      release.push(() => resolve(upstreamResponse(input)));
    }));
    const pending = worker.fetch(lookupRequest({ ipv4: IPV4, ipv6: IPV6 }), { IPINFO_TOKEN: "test-token" });
    await vi.waitFor(() => expect(release).toHaveLength(4));
    for (const resolve of release) resolve();
    expect((await pending).status).toBe(200);
  });

  it("keeps reverse DNS and addresses working without an IPinfo token", async () => {
    const response = await worker.fetch(lookupRequest({ ipv4: IPV4 }), {});
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({
      ipv4: {
        ip: IPV4,
        network: { status: "unavailable", data: null, reason: "missing_token" },
        reverseDns: { status: "ok", names: ["resolver.example.net"] },
      },
      ipv6: null,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("https://cloudflare-dns.com/");
    expect(body).not.toContain("IPINFO_TOKEN");
  });

  it("uses Cloudflare network metadata only for the directly observed address", async () => {
    const request = withCf(lookupRequest({ ipv4: IPV4, ipv6: IPV6 }, { "CF-Connecting-IP": IPV4 }), {
      asn: 12345, asOrganization: "Observed network", country: "CZ",
    });
    const response = await worker.fetch(request, {});
    expect(await response.json()).toMatchObject({
      ipv4: {
        network: {
          status: "fallback", source: "cloudflare", reason: "missing_token",
          data: { asn: "AS12345", organization: "Observed network", countryCode: "CZ", country: null },
        },
      },
      ipv6: { network: { status: "unavailable", source: "ipinfo", data: null } },
    });
  });

  it("matches canonical IPv6 addresses when selecting the Cloudflare fallback", async () => {
    const request = withCf(lookupRequest({ ipv6: IPV6 }, {
      "CF-Connecting-IP": "240.1.2.3", "CF-Connecting-IPv6": "2001:4860:4860:0:0:0:0:8888",
    }), { asn: 12345 });
    expect(await (await worker.fetch(request, {})).json()).toMatchObject({
      ipv6: { network: { status: "fallback", source: "cloudflare", data: { asn: "AS12345" } } },
    });
  });

  it("returns separate partial failures without discarding the other family or DNS result", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.origin === "https://api.ipinfo.io" && url.pathname.endsWith(IPV4)) {
        return Response.json({}, { status: 503 });
      }
      if (url.origin === "https://cloudflare-dns.com" && url.searchParams.get("name") === ptrName(IPV6)) {
        return Response.json({ Status: 2 });
      }
      return upstreamResponse(input);
    });
    const response = await worker.fetch(lookupRequest({ ipv4: IPV4, ipv6: IPV6 }), { IPINFO_TOKEN: "test-token" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ipv4: { network: { status: "error", reason: "http_error" }, reverseDns: { status: "ok" } },
      ipv6: { network: { status: "ok" }, reverseDns: { status: "error", reason: "dns_error" } },
    });
  });

  it.each([
    { asn: "not-an-asn" }, { asn: "AS4294967296" }, { country_code: "CZE" },
    { as_domain: "https://untrusted.example/" }, { as_name: "" }, { ip: "1.1.1.1" },
  ])("rejects malformed IPinfo data instead of inventing metadata", async (invalid) => {
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      return url.origin === "https://api.ipinfo.io"
        ? Response.json({ ...ipinfoResponse(IPV4), ...invalid })
        : upstreamResponse(input);
    });
    const response = await worker.fetch(lookupRequest({ ipv4: IPV4 }), { IPINFO_TOKEN: "test-token" });
    expect(await response.json()).toMatchObject({
      ipv4: { network: { status: "error", data: null, reason: "invalid_response" }, reverseDns: { status: "ok" } },
    });
  });

  it("does not forward unsupported IPinfo city, VPN, proxy, or location fields", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      return url.origin === "https://api.ipinfo.io"
        ? Response.json({ ...ipinfoResponse(IPV4), city: "Invented city", is_vpn: true, is_proxy: true, loc: "50,14" })
        : upstreamResponse(input);
    });
    const body = await (await worker.fetch(lookupRequest({ ipv4: IPV4 }), { IPINFO_TOKEN: "test-token" })).text();
    expect(body).not.toMatch(/Invented city|is_vpn|is_proxy|"loc"/);
    expect(body).toContain("Test network");
  });

  it.each([
    null, [], 4, "8.8.8.8", {}, { ipv4: null }, { ipv4: [IPV4] }, { ipv4: 123 },
    { ipv4: "127.0.0.1" }, { ipv4: "100.64.0.1" }, { ipv4: "01.2.3.4" },
    { ipv4: IPV6 }, { ipv6: IPV4 }, { ipv6: "2001:db8::1" }, { ipv6: "::ffff:8.8.8.8" },
    { ipv4: IPV4, url: "https://untrusted.example/" }, { ipv4: IPV4, extra: IPV6 },
  ])("rejects an invalid request body %j before making any subrequests", async (body) => {
    const response = await worker.fetch(lookupRequest(body), { IPINFO_TOKEN: "test-token" });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const request = new Request("https://ip.lukasberan.cz/api/lookup", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
    });
    const response = await worker.fetch(request, {});
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_json" } });
  });

  it("accepts exactly 1024 body bytes and rejects 1025 even without Content-Length", async () => {
    const body = JSON.stringify({ ipv4: IPV4 });
    for (const size of [MAX_REQUEST_BYTES, MAX_REQUEST_BYTES + 1]) {
      const request = new Request("https://ip.lukasberan.cz/api/lookup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: body + " ".repeat(size - body.length),
      });
      expect((await worker.fetch(request, {})).status).toBe(size === MAX_REQUEST_BYTES ? 200 : 413);
    }
  });

  it("rejects oversized declared bodies without calling any upstream", async () => {
    const response = await worker.fetch(lookupRequest({ ipv4: IPV4 }, {
      "Content-Length": String(MAX_REQUEST_BYTES + 1),
    }), {});
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["", "invalid", "-1", "1.5"])("rejects malformed Content-Length %j as invalid rather than oversized", async (length) => {
    const response = await worker.fetch(lookupRequest({ ipv4: IPV4 }, { "Content-Length": length }), {});
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_content_length" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["text/plain", "application/x-www-form-urlencoded"])("requires JSON rather than %s", async (type) => {
    expect((await worker.fetch(lookupRequest({ ipv4: IPV4 }, { "Content-Type": type }), {})).status).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects compressed request bodies", async () => {
    expect((await worker.fetch(lookupRequest({ ipv4: IPV4 }, { "Content-Encoding": "gzip" }), {})).status).toBe(415);
  });

  it.each([
    ["Origin", "https://untrusted.example"], ["Origin", "null"],
    ["Sec-Fetch-Site", "cross-site"], ["Sec-Fetch-Site", "same-site"],
  ])("rejects cross-origin browser use with %s: %s", async (name, value) => {
    const response = await worker.fetch(lookupRequest({ ipv4: IPV4 }, { [name]: value }), {});
    expect(response.status).toBe(403);
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts the site's own origin", async () => {
    const response = await worker.fetch(lookupRequest({ ipv4: IPV4 }, {
      Origin: "https://ip.lukasberan.cz", "Sec-Fetch-Site": "same-origin",
    }), {});
    expect(response.status).toBe(200);
  });
});

describe("API routing and response security", () => {
  it("exports only the Worker handler from the runtime entrypoint", () => {
    expect(Object.keys(entry)).toEqual(["default"]);
  });

  it("returns a no-store 500 with a generic diagnostic for unexpected internal errors", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = new Request("https://ip.lukasberan.cz/api/connection");
    Object.defineProperty(request, "cf", {
      get() { throw new Error("Sensitive internal detail must not be logged."); },
    });
    const response = await worker.fetch(request, {});
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: { code: "internal_error", message: "The request could not be processed." },
    });
    expect(log).toHaveBeenCalledExactlyOnceWith("Unexpected API failure.");
  });

  it.each([
    ["/api/connection", "POST", 405, "GET"],
    ["/api/lookup", "GET", 405, "POST"],
    ["/api/lookup", "OPTIONS", 405, "POST"],
    ["/api/unknown", "GET", 404, null],
  ])("uses a proper response for %s %s", async (path, method, status, allow) => {
    const response = await worker.fetch(new Request(`https://ip.lukasberan.cz${path}`, { method }), {});
    expect(response.status).toBe(status);
    expect(response.headers.get("Allow")).toBe(allow);
  });

  it("sets no-store and security headers on successes and every API error path", async () => {
    const requests = [
      new Request("https://ip.lukasberan.cz/api/connection"),
      lookupRequest({ ipv4: IPV4 }),
      lookupRequest({ ipv4: "127.0.0.1" }),
      lookupRequest({ ipv4: IPV4 }, { "Content-Type": "text/plain" }),
      lookupRequest({ ipv4: IPV4 }, { Origin: "https://untrusted.example" }),
      new Request("https://ip.lukasberan.cz/api/missing"),
      new Request("https://ip.lukasberan.cz/api/lookup"),
    ];
    for (const request of requests) {
      const response = await worker.fetch(request, {});
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("CDN-Cache-Control")).toBe("no-store");
      expect(response.headers.get("Cloudflare-CDN-Cache-Control")).toBe("no-store");
      expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
      expect(response.headers.has("Set-Cookie")).toBe(false);
    }
  });
});
