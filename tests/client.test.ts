// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRecord } from "../src/lib/validation";
import { connection, IPV4, IPV6, lookupResponse, networkData } from "./fixtures";

const html = readFileSync(resolve("public", "index.html"), "utf8");
const fetchMock = vi.fn<typeof fetch>();

function text(id: string): string | null {
  return document.getElementById(id)?.textContent ?? null;
}

function button(target: string): HTMLButtonElement {
  const result = document.querySelector(`button[data-copy-target="${target}"]`);
  if (!(result instanceof HTMLButtonElement)) throw new Error("The expected copy button is missing.");
  return result;
}

function defaultFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (url === "https://api.ipify.org?format=json") return Promise.resolve(Response.json({ ip: IPV4 }));
  if (url === "https://api6.ipify.org?format=json") return Promise.resolve(Response.json({ ip: IPV6 }));
  if (url === "/api/connection") {
    return Promise.resolve(Response.json(connection(IPV4, {
      asn: 12345, asOrganization: "Cloudflare network", country: "CZ",
      colo: "PRG", httpProtocol: "HTTP/2", tlsVersion: "TLSv1.3", timezone: "Europe/Prague",
    })));
  }
  if (url === "/api/lookup") {
    const body: unknown = JSON.parse(String(init?.body));
    if (!isRecord(body)) throw new Error("The lookup body must be an object.");
    const ip = body.ipv4 ?? body.ipv6;
    if (typeof ip !== "string") throw new Error("The lookup must contain one IP address.");
    return Promise.resolve(Response.json(lookupResponse(ip, {
      status: "ok", source: "ipinfo", reason: null,
      data: networkData({ organization: body.ipv4 ? "IPv4 network" : "IPv6 network" }),
    })));
  }
  throw new Error("Unexpected browser request.");
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetModules();
  document.documentElement.innerHTML = html;
  document.documentElement.lang = new DOMParser().parseFromString(html, "text/html").documentElement.lang;
  fetchMock.mockReset();
  fetchMock.mockImplementation(defaultFetch);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => { vi.useRealTimers(); });

describe("independent browser detection and rendering", () => {
  it("shows both families, distinct networks, reverse DNS, and English country labels", async () => {
    const app = await import("../src/client/app");
    await app.initialLoad;
    expect(text("ipv4-address")).toBe(IPV4);
    expect(text("ipv6-address")).toBe(IPV6);
    expect(text("ipv4-organization")).toBe("IPv4 network");
    expect(text("ipv6-organization")).toBe("IPv6 network");
    expect(text("ipv4-country")).toBe("Czechia (CZ)");
    expect(text("ipv6-dns")).toBe("resolver.example.net");
    expect(text("connection-family")).toBe("IPv4");
    expect(button("ipv4-address").disabled).toBe(false);
    expect(button("ipv6-address").disabled).toBe(false);
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/lookup")).toHaveLength(2);
    for (const [input, init] of fetchMock.mock.calls) {
      expect(init?.credentials).toBe("omit");
      if (String(input).startsWith("https://api")) expect(init?.mode).toBe("cors");
      expect(String(input)).not.toMatch(/ipinfo|dns-query/);
    }
  });

  it("keeps country names and timestamps in English regardless of browser language", async () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("de-DE");
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["de-DE"]);
    const app = await import("../src/client/app");
    await app.initialLoad;
    expect(document.documentElement.lang).toBe("en");
    expect(text("ipv4-country")).toBe("Czechia (CZ)");
    expect(text("refresh-status")).toMatch(/^Updated at \d{2}:\d{2}:\d{2}$/);
    expect(button("ipv4-address").getAttribute("aria-label")).toBe("Copy IPv4 address");
    expect(button("ipv6-organization").getAttribute("aria-label")).toBe("Copy IPv6 network organization");
  });

  it("displays and enriches IPv4 while IPv6 is still pending", async () => {
    const ipv6 = deferred<Response>();
    fetchMock.mockImplementation((input, init) =>
      String(input).includes("api6.ipify.org") ? ipv6.promise : defaultFetch(input, init),
    );
    const app = await import("../src/client/app");
    await vi.waitFor(() => expect(text("ipv4-organization")).toBe("IPv4 network"));
    expect(text("ipv4-address")).toBe(IPV4);
    expect(text("ipv6-status")).toBe("Checking IPv6");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("api6.ipify.org"))).toBe(true);
    ipv6.resolve(Response.json({ ip: IPV6 }));
    await app.initialLoad;
    expect(text("ipv6-address")).toBe(IPV6);
  });

  it("keeps IPv4 usable and explains that a failed IPv6 check is inconclusive", async () => {
    fetchMock.mockImplementation((input, init) =>
      String(input).includes("api6.ipify.org")
        ? Promise.reject(new TypeError("Blocked"))
        : defaultFetch(input, init),
    );
    const app = await import("../src/client/app");
    await app.initialLoad;
    expect(text("ipv4-address")).toBe(IPV4);
    expect(text("ipv6-status")).toBe("IPv6 could not be verified");
    expect(text("ipv6-note")).toContain("does not prove");
    expect(button("ipv6-address").disabled).toBe(true);
  });

  it("supports IPv6-only connectivity when the IPv4 check fails", async () => {
    fetchMock.mockImplementation((input, init) => {
      if (String(input) === "/api/connection") return Promise.resolve(Response.json(connection(IPV6)));
      if (String(input).includes("api.ipify.org")) return Promise.reject(new TypeError("IPv4 unavailable"));
      return defaultFetch(input, init);
    });
    const app = await import("../src/client/app");
    await app.initialLoad;
    expect(text("ipv6-address")).toBe(IPV6);
    expect(text("ipv4-status")).toBe("IPv4 could not be verified");
    expect(text("connection-family")).toBe("IPv6");
    expect(button("ipv6-address").disabled).toBe(false);
  });

  it("uses the observed address as an explicitly labelled fallback, only for its own family", async () => {
    fetchMock.mockImplementation((input, init) => {
      if (String(input).includes("ipify.org")) return Promise.reject(new TypeError("ipify unavailable"));
      if (String(input) === "/api/connection") {
        return Promise.resolve(Response.json(connection(IPV6, { asn: 12345, country: "CZ" })));
      }
      return defaultFetch(input, init);
    });
    const app = await import("../src/client/app");
    await app.initialLoad;
    expect(text("ipv6-address")).toBe(IPV6);
    expect(text("ipv6-status")).toBe("Address observed by Cloudflare");
    expect(text("ipv6-note")).toContain("IPv6 could not be verified via ipify");
    expect(text("ipv4-address")).toBe("—");
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/lookup")).toHaveLength(1);
  });

  it("does not use a local or private observed address as a public fallback", async () => {
    fetchMock.mockImplementation((input, init) => {
      if (String(input).includes("ipify.org")) return Promise.reject(new TypeError("Unavailable"));
      if (String(input) === "/api/connection") return Promise.resolve(Response.json(connection("127.0.0.1")));
      return defaultFetch(input, init);
    });
    const app = await import("../src/client/app");
    await app.initialLoad;
    expect(text("connection-ip")).toBe("127.0.0.1");
    expect(text("ipv4-address")).toBe("—");
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/lookup")).toBe(false);
  });

  it.each([{ ip: "127.0.0.1" }, { ip: IPV6 }, { ip: "01.2.3.4" }, { ip: 123 }, {}])(
    "rejects invalid IPv4 detector data %j",
    async (invalid) => {
      fetchMock.mockImplementation((input, init) => {
        if (String(input).includes("api.ipify.org")) return Promise.resolve(Response.json(invalid));
        if (String(input) === "/api/connection") return Promise.resolve(Response.json(connection(null)));
        return defaultFetch(input, init);
      });
      const app = await import("../src/client/app");
      await app.initialLoad;
      expect(text("ipv4-status")).toBe("IPv4 could not be verified");
      expect(button("ipv4-address").disabled).toBe(true);
      expect(text("ipv6-address")).toBe(IPV6);
    },
  );

  it("times out a stalled detector after exactly five seconds without blocking IPv4", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((input, init) => {
      if (String(input).includes("api6.ipify.org")) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      }
      return defaultFetch(input, init);
    });
    const app = await import("../src/client/app");
    await vi.advanceTimersByTimeAsync(4_999);
    expect(text("ipv4-address")).toBe(IPV4);
    expect(text("ipv6-status")).toBe("Checking IPv6");
    await vi.advanceTimersByTimeAsync(1);
    await app.initialLoad;
    expect(text("ipv6-status")).toBe("IPv6 could not be verified");
    expect(text("ipv6-note")).toContain("5 seconds");
  });

  it("keeps detected addresses when the first-party connection or enrichment API fails", async () => {
    fetchMock.mockImplementation((input, init) =>
      String(input).startsWith("/api/")
        ? Promise.reject(new TypeError("Worker unavailable"))
        : defaultFetch(input, init),
    );
    const app = await import("../src/client/app");
    await app.initialLoad;
    expect(text("ipv4-address")).toBe(IPV4);
    expect(text("ipv6-address")).toBe(IPV6);
    expect(text("ipv4-organization")).toBe("Unavailable");
    expect(text("ipv6-dns")).toBe("DNS lookup failed");
    expect(text("connection-source")).toContain("failed");
  });

  it("uses matching Cloudflare metadata without applying it to a different IPv6 address", async () => {
    fetchMock.mockImplementation((input, init) => {
      if (String(input) === "/api/lookup") {
        const body: unknown = JSON.parse(String(init?.body));
        if (!isRecord(body)) throw new Error("Invalid test body.");
        const ip = body.ipv4 ?? body.ipv6;
        if (typeof ip !== "string") throw new Error("Missing test IP.");
        return Promise.resolve(Response.json(lookupResponse(ip, {
          status: "unavailable", source: "ipinfo", data: null, reason: "missing_token",
        })));
      }
      return defaultFetch(input, init);
    });
    const app = await import("../src/client/app");
    await app.initialLoad;
    expect(text("ipv4-organization")).toBe("Cloudflare network");
    expect(text("ipv4-source")).toContain("Cloudflare for this address");
    expect(text("ipv6-organization")).toBe("Unavailable");
    expect(text("ipv6-source")).toContain("IPinfo is not configured");
    expect(text("ipv6-dns")).toBe("resolver.example.net");
  });

  it("distinguishes no PTR record from a failed DNS lookup", async () => {
    fetchMock.mockImplementation((input, init) => {
      if (String(input) !== "/api/lookup") return defaultFetch(input, init);
      const body: unknown = JSON.parse(String(init?.body));
      if (!isRecord(body)) throw new Error("Invalid test body.");
      const ip = body.ipv4 ?? body.ipv6;
      if (typeof ip !== "string") throw new Error("Missing test IP.");
      return Promise.resolve(Response.json(lookupResponse(ip, undefined,
        body.ipv4 ? { status: "none", names: [], reason: null } : { status: "error", names: [], reason: "dns_error" },
      )));
    });
    const app = await import("../src/client/app");
    await app.initialLoad;
    expect(text("ipv4-dns")).toBe("No PTR record found");
    expect(text("ipv6-dns")).toBe("DNS lookup failed");
    expect(button("ipv4-dns").hidden).toBe(true);
    expect(button("ipv6-dns").hidden).toBe(true);
  });

  it("renders external organization text literally rather than injecting HTML", async () => {
    const organization = '<img src=x onerror="globalThis.pwned=true">';
    fetchMock.mockImplementation((input, init) => {
      if (String(input) !== "/api/lookup") return defaultFetch(input, init);
      const body: unknown = JSON.parse(String(init?.body));
      if (!isRecord(body)) throw new Error("Invalid test body.");
      const ip = body.ipv4 ?? body.ipv6;
      if (typeof ip !== "string") throw new Error("Missing test IP.");
      return Promise.resolve(Response.json(lookupResponse(ip, {
        status: "ok", source: "ipinfo", reason: null, data: networkData({ organization }),
      })));
    });
    const app = await import("../src/client/app");
    await app.initialLoad;
    expect(text("ipv4-organization")).toBe(organization);
    expect(document.querySelector("#ipv4-organization img")).toBeNull();
    expect(Reflect.get(window, "pwned")).toBeUndefined();
  });

  it("rejects all-null network data even if an unrecognized extra field is present", async () => {
    fetchMock.mockImplementation((input, init) => {
      if (String(input) !== "/api/lookup" || typeof init?.body !== "string" || !init.body.includes('"ipv6"')) {
        return defaultFetch(input, init);
      }
      return Promise.resolve(Response.json({
        ipv4: null,
        ipv6: {
          ip: IPV6, family: "ipv6",
          network: {
            status: "ok", source: "ipinfo", reason: null,
            data: {
              asn: null, organization: null, domain: null, countryCode: null,
              country: null, continentCode: null, continent: null, unrecognized: true,
            },
          },
          reverseDns: { status: "none", names: [], reason: null },
        },
      }));
    });
    const app = await import("../src/client/app");
    await app.initialLoad;
    expect(text("ipv6-address")).toBe(IPV6);
    expect(text("ipv6-source")).toBe("Network data is currently unavailable. DNS: Cloudflare.");
    expect(text("ipv6-dns")).toBe("DNS lookup failed");
    expect(text("ipv4-organization")).toBe("IPv4 network");
  });

  it("prevents stale results from overwriting a newer refresh", async () => {
    const oldIpv4 = deferred<Response>();
    fetchMock.mockImplementation((input, init) =>
      String(input).includes("api.ipify.org") ? oldIpv4.promise : defaultFetch(input, init),
    );
    const app = await import("../src/client/app");
    fetchMock.mockImplementation((input, init) =>
      String(input).includes("api.ipify.org")
        ? Promise.resolve(Response.json({ ip: "9.9.9.9" }))
        : defaultFetch(input, init),
    );
    await app.refresh();
    expect(text("ipv4-address")).toBe("9.9.9.9");
    oldIpv4.resolve(Response.json({ ip: IPV4 }));
    await app.initialLoad;
    expect(text("ipv4-address")).toBe("9.9.9.9");
    expect(document.getElementById("refresh-button")?.getAttribute("aria-busy")).toBe("false");
  });
});

describe("copy actions", () => {
  it("copies the displayed address and announces success", async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const app = await import("../src/client/app");
    await app.initialLoad;
    button("ipv6-address").click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(IPV6));
    expect(text("copy-feedback")).toBe("IPv6 address: copied to clipboard.");
  });

  it("reports a clipboard permission failure without claiming success", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new DOMException("Denied", "NotAllowedError")) },
      configurable: true,
    });
    const app = await import("../src/client/app");
    await app.initialLoad;
    button("ipv4-address").click();
    await vi.waitFor(() => expect(text("copy-feedback")).toContain("Could not copy the value"));
    expect(document.getElementById("copy-feedback")?.dataset.state).toBe("error");
  });

  it("explains when the Clipboard API is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const app = await import("../src/client/app");
    await app.initialLoad;
    button("ipv4-address").click();
    expect(text("copy-feedback")).toContain("Clipboard access is unavailable in this browser");
  });
});
