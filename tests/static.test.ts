import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRecord } from "../src/lib/validation";

describe("deployment and static security contracts", () => {
  it("configures the requested Worker, Custom Domain, asset routing, and disabled observability", () => {
    const config: unknown = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
    expect(config).toMatchObject({
      name: "ip-lukasberan",
      main: "./src/index.ts",
      compatibility_date: "2026-11-03",
      routes: [{ pattern: "ip.lukasberan.cz", custom_domain: true }],
      assets: { directory: "./public", run_worker_first: ["/api/*"], not_found_handling: "404-page" },
      observability: {
        enabled: false, logs: { enabled: false, invocation_logs: false }, traces: { enabled: false },
      },
    });
    if (!isRecord(config)) throw new Error("Wrangler configuration must be an object.");
    for (const binding of ["account_id", "kv_namespaces", "d1_databases", "r2_buckets", "durable_objects"]) {
      expect(config).not.toHaveProperty(binding);
    }
  });

  it("allows only the two ipify browser services in the CSP", () => {
    const headers = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
    expect(headers).toContain("connect-src 'self' https://api.ipify.org https://api6.ipify.org;");
    expect(headers).not.toMatch(/unsafe-inline|unsafe-eval|api\.ipinfo\.io|cloudflare-dns\.com/);
    expect(headers).toContain("frame-ancestors 'none'");
    expect(headers).toContain("X-Frame-Options: DENY");
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    expect(headers).toContain("Referrer-Policy: no-referrer");
    expect(headers).toContain("Permissions-Policy:");
  });

  it("has a Czech static shell without inline scripts, unsafe DOM writes, or persistent browser storage", () => {
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    const source = readFileSync(new URL("../src/client/app.ts", import.meta.url), "utf8");
    expect(html).toContain('<html lang="cs">');
    expect(html).toContain('<script src="/app.js" type="module"></script>');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)|\bonclick=|\bstyle=/);
    expect(source).not.toMatch(/\b(innerHTML|outerHTML|insertAdjacentHTML|localStorage|sessionStorage)\b|document\.cookie/);
    expect(html).toContain('href="https://github.com/luberan/ip-info"');
  });
});
