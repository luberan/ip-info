import { fetchJson, UpstreamError } from "./http";
import { parsePublicIp, ptrName } from "./ip";
import type { DnsResult } from "./types";
import { isDnsName, isRecord } from "./validation";

// Intermediate owners in a classless reverse zone can contain a slash (RFC 2317).
function ownerName(value: unknown): string {
  if (typeof value === "string" && value.length <= 254) {
    const name = value.replace(/\.$/, "");
    if (name.length <= 253 && name.split(".").every((part) => /^[a-z0-9_/-]{1,63}$/i.test(part))) {
      return name.toLowerCase();
    }
  }
  throw new UpstreamError("invalid_response");
}

function parseAnswer(data: unknown, question: string): DnsResult {
  if (!isRecord(data) || !Number.isInteger(data.Status) || (data.TC !== undefined && data.TC !== false)) {
    throw new UpstreamError("invalid_response");
  }
  if (data.Question !== undefined) {
    const questions = data.Question;
    if (
      !Array.isArray(questions) || questions.length !== 1 || !isRecord(questions[0]) ||
      questions[0].type !== 12 || ownerName(questions[0].name) !== question
    ) {
      throw new UpstreamError("invalid_response");
    }
  }
  if (data.Status === 3) return { status: "none", names: [], reason: null };
  if (data.Status !== 0) throw new UpstreamError("dns_error");
  if (data.Answer === undefined) return { status: "none", names: [], reason: null };
  if (!Array.isArray(data.Answer) || data.Answer.length > 64) throw new UpstreamError("invalid_response");

  const aliases = new Map<string, string>();
  const pointers = new Map<string, Set<string>>();
  for (const answer of data.Answer) {
    if (!isRecord(answer) || !Number.isInteger(answer.type)) throw new UpstreamError("invalid_response");
    if (answer.type !== 5 && answer.type !== 12) continue;
    const owner = ownerName(answer.name);
    if (answer.type === 5) {
      const target = ownerName(answer.data);
      if (aliases.has(owner) && aliases.get(owner) !== target) throw new UpstreamError("invalid_response");
      aliases.set(owner, target);
    } else {
      if (!isDnsName(answer.data)) throw new UpstreamError("invalid_response");
      const names = pointers.get(owner) ?? new Set<string>();
      names.add(answer.data.replace(/\.$/, "").toLowerCase());
      pointers.set(owner, names);
    }
  }

  let owner = question;
  const visited = new Set<string>();
  for (let next = aliases.get(owner); next !== undefined; next = aliases.get(owner)) {
    if (visited.has(owner)) throw new UpstreamError("invalid_response");
    visited.add(owner);
    owner = next;
  }
  const names = pointers.get(owner);
  return names ? { status: "ok", names: [...names], reason: null } : { status: "none", names: [], reason: null };
}

export async function reverseDns(value: string, signal?: AbortSignal): Promise<DnsResult> {
  const ip = parsePublicIp(value);
  if (!ip) throw new TypeError("Reverse DNS requires a public IP address.");
  const url = new URL("https://cloudflare-dns.com/dns-query");
  const question = ptrName(ip.value);
  url.searchParams.set("name", question);
  url.searchParams.set("type", "PTR");
  try {
    const data = await fetchJson(url, { headers: { Accept: "application/dns-json" }, signal });
    return parseAnswer(data, question);
  } catch (error) {
    if (error instanceof UpstreamError) return { status: "error", names: [], reason: error.reason };
    throw error;
  }
}
