import { fetchJson, UpstreamError } from "./http";
import { parsePublicIp, ptrName } from "./ip";
import type { DnsResult } from "./types";
import { isDnsName, isRecord } from "./validation";

export async function reverseDns(value: string): Promise<DnsResult> {
  const ip = parsePublicIp(value);
  if (!ip) throw new TypeError("Reverse DNS requires a public IP address.");
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.searchParams.set("name", ptrName(ip.value));
  url.searchParams.set("type", "PTR");
  try {
    const data = await fetchJson(url, { headers: { Accept: "application/dns-json" } });
    if (!isRecord(data) || !Number.isInteger(data.Status) || data.TC === true) {
      throw new UpstreamError("invalid_response");
    }
    if (data.Status === 3) return { status: "none", names: [], reason: null };
    if (data.Status !== 0) throw new UpstreamError("dns_error");
    if (data.Answer === undefined) return { status: "none", names: [], reason: null };
    if (!Array.isArray(data.Answer) || data.Answer.length > 64) {
      throw new UpstreamError("invalid_response");
    }
    const names = new Set<string>();
    for (const answer of data.Answer) {
      if (!isRecord(answer) || !Number.isInteger(answer.type) || !isDnsName(answer.name)) {
        throw new UpstreamError("invalid_response");
      }
      if (answer.type !== 12) continue;
      if (!isDnsName(answer.data)) throw new UpstreamError("invalid_response");
      names.add(answer.data.replace(/\.$/, "").toLowerCase());
    }
    return names.size > 0
      ? { status: "ok", names: [...names], reason: null }
      : { status: "none", names: [], reason: null };
  } catch (error) {
    if (error instanceof UpstreamError) return { status: "error", names: [], reason: error.reason };
    throw error;
  }
}
