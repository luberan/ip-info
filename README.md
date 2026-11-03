# IP Address Information

[![CI](https://github.com/luberan/ip-info/actions/workflows/ci.yml/badge.svg)](https://github.com/luberan/ip-info/actions/workflows/ci.yml)
[![Scorecard](https://github.com/luberan/ip-info/actions/workflows/scorecard.yml/badge.svg)](https://github.com/luberan/ip-info/actions/workflows/scorecard.yml)

A small, open-source English-language network diagnostic tool for **https://ip.lukasberan.cz**.
One Cloudflare Worker serves a vanilla frontend with Static Assets and a narrow
TypeScript API. No accounts, cookies, analytics, database, or paid Cloudflare bindings.

All interface text and country/time formatting use English, regardless of browser
language. Organization and location names are displayed as supplied by the data
providers.

## Features and architecture

- Independent, concurrent browser checks for public IPv4 and IPv6 using
  `https://api.ipify.org?format=json` and `https://api6.ipify.org?format=json`.
- Five-second detection deadlines and independent loading/error states.
- Server-side IPinfo Lite ASN, AS organization/domain, country, and continent data.
- IPv4/IPv6 PTR resolution through Cloudflare DNS over HTTPS, including multiple
  answers and a distinction between missing records and failed queries.
- Directly observed Cloudflare connection address and available ASN, location,
  timezone, colo, HTTP, and TLS metadata.
- Explicitly labelled Cloudflare fallbacks, copy buttons, refresh without page
  navigation, responsive layout, accessible controls, and OS light/dark themes.
- Strict public-IP validation, bounded bodies, fixed upstream URLs, restrictive
  security headers, and `no-store` on every API response.

The browser contacts ipify directly: a Worker-side ipify request would discover
the Worker's egress address, **not the visitor's**. A single dual-stack connection
only reveals the family actually used. An unsuccessful IPv6 test is inconclusive:
connectivity, DNS, a content blocker, or ipify itself may be responsible. IPv4 and
IPv6 may use different networks or VPN exits.

Cloudflare metadata is attached only to the address observed on that particular
API request. A Pseudo IPv4 overwrite is recognized using the Class E primary
header and the preserved `CF-Connecting-IPv6`; a synthetic address is never shown
as a real public IPv4 fallback.

The shared `ipaddr.js` parser is bundled into the browser JavaScript using esbuild.
The frontend uses no framework, CDN scripts, external fonts, or runtime build
service. `public/app.js` is generated from readable TypeScript sources and ignored
by Git; every development, build, and deployment command generates it.

## Requirements

- Node.js **22.22.2+ on the 22.x line, 24.15.0+ on the 24.x line, or 26+**, and npm.
  `.node-version` pins 24.15.0 for reproducible hosting builds.
- A Cloudflare account on Workers Free.
- An active Cloudflare DNS zone for `lukasberan.cz` to use the Custom Domain.
- An IPinfo Lite token for enrichment; detection and DNS still work without it.
- A modern browser with JavaScript. Clipboard access requires HTTPS or localhost.

## Installation and local development

```sh
git clone https://github.com/luberan/ip-info.git
cd ip-info
npm ci
```

In PowerShell, create the optional local secret file:

```powershell
Copy-Item .dev.vars.example .dev.vars
```

On macOS/Linux, use `cp .dev.vars.example .dev.vars`. Edit `.dev.vars` locally and
set `IPINFO_TOKEN` to your token, or leave it empty to test graceful degradation.
Do not commit this file.

```sh
npm run dev
```

Open the localhost URL printed by Wrangler (normally http://localhost:8787).
Wrangler watches the Worker and static assets. After changing `src/client`,
run `npm run build:assets` in another terminal to regenerate the browser bundle.
Changes to HTML/CSS do not need bundling.

`request.cf` and trusted visitor headers may be absent or incomplete locally.
Unavailable values are intentional; local loopback addresses are never enriched
or presented as public detection fallbacks. Do not treat manually supplied
Cloudflare headers as authenticated metadata outside Cloudflare's edge.

## Testing and build validation

```sh
npm test
npm run typecheck
npm run build
npm run test:smoke
```

Vitest uses mocked HTTP responses, never live ipify, IPinfo, or DNS dependencies.
Tests cover strict address parsing and special-purpose ranges, compressed and
embedded IPv6 PTR names, request limits, methods/origins, missing metadata/token,
partial failures, timeouts (including stalled bodies), no-store headers, browser
concurrency, fallback association, safe DOM rendering, stale refresh cancellation,
and clipboard errors. Browser tests use jsdom; production has no jsdom dependency.

`npm run build` type-checks both Worker and browser contexts, bundles the browser,
and validates Wrangler with `wrangler deploy --dry-run`. Its output is local to
`.wrangler/build`; **this is not a production deployment or an edge CPU benchmark**.

`npm run test:smoke` starts the real local Workers runtime through Wrangler's test
harness and always shuts it down afterwards. It checks asset and 404 routing, the
connection endpoint, API validation/methods, security headers, and no-store
responses. It overrides the IPinfo token with an empty test secret and makes no
ipify, IPinfo, or DNS requests. No Cloudflare account credentials are needed.

## GitHub automation

GitHub Actions runs **tests, type checks, build validation, and runtime smoke
checks** on pull requests, pushes to `main`, weekly, and on manual request.
The main job uses the production Node version from `.node-version`; compatibility
jobs also test the supported Node 22 minimum and current Node 26 releases.

- **CodeQL:** GitHub-managed default setup with extended security queries for
  JavaScript/TypeScript. Manage it under **Settings → Advanced Security → Code
  scanning**; do not add a second CodeQL analysis workflow alongside default setup.
- **Dependabot:** weekly npm and GitHub Actions update PRs. Patch/minor updates
  are grouped; major upgrades remain separate. Security update PRs have their own
  group. Updates are never automatically merged.
- **Dependency review:** pull requests introducing known high/critical
  vulnerabilities receive a failed check, including development dependencies.
- **OpenSSF Scorecard:** trusted-branch and weekly supply-chain posture checks,
  uploaded to GitHub's code-scanning dashboard. Results are not published to a
  separate external Scorecard service and need no extra token.
- **Secret protection:** keep secret scanning and push protection enabled.
  Supported-pattern scanning is not a guarantee that every IPinfo or other token
  format will be recognized. Never rely on it instead of keeping secrets out of Git.
  Optional generic-pattern scanning and partner-token validity checks require an
  eligible organization/Secret Protection plan and are not enabled by this setup.
- **Private vulnerability reports:** use the process in
  [the security policy](.github/SECURITY.md).

Workflows use standard GitHub-hosted Ubuntu runners, immutable action commit
pins, read-only checkout credentials, and no production secrets. Only the trusted
Scorecard job can upload security events; untrusted PR code never uses
`pull_request_target` or a privileged workflow-run handoff. npm caching avoids
repeated downloads without retaining test-report artifacts.

**Direct pushes to `main` remain allowed.** Checks are informative, not mandatory
merge gates. A failed GitHub check does not stop Cloudflare Workers Builds;
Cloudflare independently runs its configured build command. GitHub Actions does
not deploy the Worker or receive Cloudflare/IPinfo credentials.

Standard GitHub-hosted runner compute is free for public repositories. Larger
runners, storage overages, and optional paid security features have separate
billing rules; this setup does not enable them. Scorecard findings about absent
mandatory reviews or branch protection are expected under the chosen direct-push
workflow, not proof of an exploitable application vulnerability.

## API

Both endpoints are same-origin, return UTF-8 JSON, and set `Cache-Control: no-store`,
`CDN-Cache-Control: no-store`, and `Cloudflare-CDN-Cache-Control: no-store`.
No personalized response is placed in the Workers Cache API.

### `GET /api/connection`

```json
{
  "ip": "2001:4860:4860::8888",
  "family": "ipv6",
  "ipSource": "cf-connecting-ip",
  "pseudoIpv4": null,
  "reason": null,
  "metadata": {
    "asn": null,
    "asOrganization": null,
    "country": null,
    "region": null,
    "city": null,
    "timezone": null,
    "colo": null,
    "httpProtocol": null,
    "tlsVersion": null
  }
}
```

This is an illustrative shape, not real visitor data. Missing fields are `null`.
If no trusted address is available, `ip`, `family`, and `ipSource` are `null` and
`reason` is `client_ip_unavailable` or `pseudo_ipv4_without_ipv6`.
`ipSource` is `cf-connecting-ipv6` when restoring a Pseudo IPv4 overwrite.
City/region information, when available, is approximate and connection-specific;
the API never exposes coordinates.

### `POST /api/lookup`

Use `Content-Type: application/json` and at least one of:

```json
{ "ipv4": "8.8.8.8", "ipv6": "2001:4860:4860::8888" }
```

Only these two optional string fields are allowed, with at most one IP per family.
Bodies are limited to **1,024 actual bytes**, including chunked bodies, and
compressed request bodies are rejected. Addresses must be canonicalizable global
unicast: private, loopback, link-local, shared/CGNAT, documentation, multicast,
IPv4-mapped IPv6, and special-purpose/transition ranges are excluded. This is a
deliberately conservative policy, not an arbitrary-address lookup service.

The response has separate `ipv4` and `ipv6` slots; an unrequested slot is `null`.
Each requested slot contains:

```json
{
  "ip": "8.8.8.8",
  "family": "ipv4",
  "network": {
    "status": "ok",
    "source": "ipinfo",
    "reason": null,
    "data": {
      "asn": "AS15169",
      "organization": "Example organization",
      "domain": "example.net",
      "countryCode": "US",
      "country": "United States",
      "continentCode": "NA",
      "continent": "North America"
    }
  },
  "reverseDns": {
    "status": "none",
    "names": [],
    "reason": null
  }
}
```

Values above are examples. Network statuses are `ok` (IPinfo), `fallback`
(Cloudflare for the matching observed IP), `unavailable` (missing token), or
`error`. Unavailable/error data is `null`; fallback data has no unsupported
IPinfo fields. DNS statuses are `ok`, `none` (NXDOMAIN/no PTR), or `error`.
Failure reasons include `missing_token`, `timeout`, `http_error`, `network_error`,
`invalid_response`, `dns_error`, and `internal_error`.

Accepted lookups return 200 even when enrichment partially fails; the explicit
per-service status explains the failure and preserves the other results. Invalid
requests return 400, cross-origin browser lookups 403, unknown endpoints 404,
incorrect methods 405 with `Allow`, oversized bodies 413, unsupported types or
encodings 415, and unexpected internal failures 500. Errors have
`{"error":{"code":"...","message":"..."}}`. No upstream response or secret is echoed.

IPinfo Lite does **not** provide city location, VPN/proxy detection, or paid
features. AS organization is not necessarily the consumer-facing ISP brand.
PTR records are DNS information, not verified host identity.

## Cloudflare Workers Builds: GitHub to production

No GitHub Actions deployment workflow is needed. Use Cloudflare's native
[Workers Builds integration](https://developers.cloudflare.com/workers/ci-cd/builds/).

1. **Prepare the zone.** Add `lukasberan.cz` to Cloudflare and ensure the zone is
   Active. Keep Network → IPv6 Compatibility enabled so IPv6-only visitors can
   access the first-party site. Resolve any conflicting DNS record for
   `ip.lukasberan.cz` before creating its Worker Custom Domain.
2. **Publish the source.** Commit the project files, including `package-lock.json`,
   to the public `luberan/ip-info` repository and push `main`. Generated bundles,
   dependencies, `.dev.vars`, and environment files are ignored.
3. **Connect GitHub.** In Cloudflare, open **Workers & Pages → Create application →
   GitHub** (not a Pages project). Authorize the Cloudflare GitHub app for this
   repository, select `luberan/ip-info`, and configure:

   | Setting | Value |
   | --- | --- |
   | Worker/project name | **`ip-lukasberan`**, exactly as in Wrangler |
   | Production branch | `main` |
   | Root directory | Repository root (`/`) |
   | Build command | `npm ci && npm test && npm run build` |
   | Deploy command | `npm run deploy` |
   | Build variable | `NODE_VERSION=24.15.0` |
   | Plan | Workers Free |

   Allow Cloudflare to generate its scoped deployment API token. Do not add
   account IDs or credentials to the repository. Disable preview-branch builds
   initially: this project deliberately disables public preview URLs and defines
   only its production Custom Domain.
4. **Save and Deploy.** The Wrangler configuration registers `ip.lukasberan.cz`
   with `custom_domain: true`. Verify it under the Worker's **Settings →
   Domains & Routes** and wait for DNS/certificate activation. `workers.dev` is
   disabled; use the Custom Domain, not an automatically suggested subdomain.
   The initial deployment remains functional without IPinfo enrichment.
5. **Add the runtime secret.** Register for [IPinfo Lite](https://ipinfo.io/lite)
   and copy your token from the [IPinfo dashboard](https://ipinfo.io/dashboard/token).
   In **Workers & Pages → ip-lukasberan → Settings → Variables & Secrets → Add**,
   choose **Secret**, name it **`IPINFO_TOKEN`**, and paste the token. Save/deploy
   the change. This is a **Worker runtime secret**, not a Builds environment
   variable, a plaintext Wrangler `vars` entry, or a browser setting. Normal
   Wrangler deployments preserve existing Worker secrets.
6. **Verify the live site.** Open https://ip.lukasberan.cz, test copy/refresh,
   check `/api/connection`, and confirm `no-store` on API responses. Check both
   families on actual IPv4/IPv6-capable networks. Missing IPv6 alone is not proof
   of a disabled protocol.
7. **Subsequent releases.** Commit and push to `main`; Cloudflare installs,
   validates, and deploys automatically. Inspect **Deployments / build history**
   if a build fails. Keep the runtime secret out of Git and build logs.

For an existing Worker, use **ip-lukasberan → Settings → Builds → Connect** and
apply the same settings. The dashboard name must match `wrangler.jsonc`.

### Optional manual deployment

```sh
npm ci
npm test
npm run build
npx wrangler login
npm run deploy
npx wrangler secret put IPINFO_TOKEN
```

Enter the secret only at Wrangler's interactive prompt. The last command requires
the Worker to exist; runtime secrets cannot be provisioned by committing them.
You can then connect that existing Worker to Builds as described above.

## Privacy, security, and Free-plan limits

The English privacy notice explains the browser's ipify requests, the Worker's
IPinfo enrichment, Cloudflare DNS queries, and providers' possible processing of
connection information. The application stores no visitor data in a database or
persistent browser storage and does not log IP addresses. Unexpected failures
have generic diagnostics with no request, token, or upstream payload logging.

Wrangler disables Workers Logs, invocation logs, tracing, and Logpush. This does
**not** eliminate Cloudflare's infrastructure/security processing or logs operated
by ipify/IPinfo/DNS providers. Do not enable Cloudflare Web Analytics, automatic
tracking injections, or other nonessential scripts without updating the CSP and
privacy notice.

Static responses use `public/_headers`; Worker responses set their own headers.
The browser CSP permits only same-origin assets/APIs and the two ipify endpoints.
No upstream strings become HTML. No URL can be supplied to the API, redirects are
not followed, upstream JSON is size-limited, and lookups time out after 3.5 seconds.

Static Assets are served directly. A normal dual-stack refresh uses one connection
request and one lookup per detected family (up to three Worker invocations).
A batched API lookup makes at most four parallel upstream requests, below the
Free plan's 50 subrequest and six outgoing-connection limits. The application has
no KV, D1, R2, Durable Objects, or background work. Free Workers still have a
100,000-request daily allowance and a 10 ms CPU limit; network wait time is not
CPU time. Production traffic/CPU and upstream availability must be monitored in
Cloudflare's aggregate metrics. A public API can consume its quota under abuse;
consider a zone-level rate rule for `/api/lookup` if needed.

**Never add Cache Everything or an Edge TTL override to `/api/*`.** Do not place
personalized API responses in a shared cache. Standard static-asset caching is
safe; it contains no rendered visitor information.

## Project structure

```text
public/
  index.html, 404.html, styles.css, favicon.svg, _headers
  app.js                     Generated browser bundle (ignored by Git)
src/
  index.ts                   Narrow Worker API router
  client/
    app.ts, validation.ts    Vanilla UI, independent checks, response validation
  lib/
    ip.ts                    Shared strict parser and PTR name construction
    connection.ts            Trusted Cloudflare connection extraction
    metadata.ts              Shared, explicitly scoped metadata fallback
    lookup.ts, dns.ts         IPinfo Lite and Cloudflare DoH
    http.ts, response.ts      Deadlines, bounded JSON, secure API responses
    types.ts, validation.ts   Response contracts and validation helpers
tests/                       Mocked Worker, IP, DNS, HTTP, browser, config tests
scripts/smoke.mjs             Real Workers runtime smoke checks
.github/
  workflows/                 CI, dependency review, and Scorecard (no deployment)
  dependabot.yml             npm and action update PRs
  SECURITY.md                Private vulnerability reporting policy
wrangler.jsonc               Static Assets, Custom Domain, disabled observability
tsconfig*.json               Separate Worker and browser type environments
vitest.config.ts             Automated test configuration
package.json, package-lock.json, .node-version
.dev.vars.example, .gitignore, LICENSE
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| IPv6 cannot be verified | Try an IPv6-capable network, disable a blocker for ipify, and retry. Do not infer that IPv6 is disabled. |
| Addresses work but IPinfo does not | Verify the **runtime** `IPINFO_TOKEN` secret, the Lite plan, and upstream availability. DNS is independent. |
| PTR record not found | This is a valid DNS result, unlike a failed DNS query. Many public addresses have no PTR. |
| Local Cloudflare fields are unavailable | `request.cf` and client headers are incomplete locally; do not add fabricated values. |
| Browser changes are not visible | Run `npm run build:assets`; HTML/CSS and the generated bundle are watched by Wrangler. |
| Copy fails | Use HTTPS/localhost and allow clipboard writes, or select and copy the value manually. |
| Builds reports a name mismatch | Both dashboard and Wrangler must use `ip-lukasberan`. |
| Builds fails on Node/dependencies | Use Node 24.15.0, commit the lockfile, and install with `npm ci`. |
| Windows hot reload reports `spawn EPERM` | Stop Wrangler and restart `npm run dev`; the local runtime may fail to respawn on Windows. |
| Custom Domain does not activate | Confirm the active zone, conflicting DNS records, and TLS certificate status. |
| CSP errors | Do not inject third-party scripts/fonts; only the documented ipify browser hosts are allowed. |

## License

[MIT](LICENSE). The bundled `ipaddr.js` parser is also MIT-licensed; its copyright
and permission notice are retained in the shared parser and generated bundles.
