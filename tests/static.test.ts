import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRecord } from "../src/lib/validation";

const untranslatedDiacritics = /[\u00e1\u010d\u010f\u00e9\u011b\u00ed\u0148\u00f3\u0159\u0161\u0165\u00fa\u016f\u00fd\u017e]/iu;

describe("deployment and static security contracts", () => {
  it.each([
    ["index.html", "My IP address · IPv4 and IPv6"],
    ["404.html", "Page not found · My IP address"],
  ])("serves English metadata and copy in %s", (file, title) => {
    const html = readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta name="color-scheme" content="dark">');
    expect(html).toContain('<meta name="theme-color" content="#0b1020">');
    expect(html).toContain('<link rel="stylesheet" href="/styles.css">');
    expect(html).toContain(`<title>${title}</title>`);
    expect(html.replace("Luk\u00e1\u0161 Beran", "")).not.toMatch(untranslatedDiacritics);
  });

  it("uses pipe-separated platform, provider, and creator credits in the footer", () => {
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    const footer = html.match(/<footer\b[^>]*>([\s\S]*?)<\/footer>/u)?.[1];
    expect(footer).toContain('Powered by <a href="https://www.cloudflare.com/">Cloudflare Workers</a> | Network data by ');
    expect(footer).toContain('IPinfo Lite</a> | Detection by ');
    expect(footer).toContain('ipify</a> | Created by <a href="https://www.lukasberan.cz/"><strong>Luk\u00e1\u0161 Beran</strong></a>');
    expect(footer).not.toContain("\u00b7");
  });

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

  it("has an English static shell without inline scripts, unsafe DOM writes, or persistent browser storage", () => {
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    const source = readFileSync(new URL("../src/client/app.ts", import.meta.url), "utf8");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<script src="/app.js" type="module"></script>');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)|\bonclick=|\bstyle=/);
    expect(source).not.toMatch(/\b(innerHTML|outerHTML|insertAdjacentHTML|localStorage|sessionStorage)\b|document\.cookie/);
    expect(source).not.toMatch(untranslatedDiacritics);
    expect(html).toContain('href="https://github.com/luberan/ip-info"');
  });
});
