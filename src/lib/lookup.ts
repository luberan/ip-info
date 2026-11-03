import { reverseDns } from "./dns";
import { fetchJson, UpstreamError } from "./http";
import { parseIp, parsePublicIp } from "./ip";
import type { ParsedIp } from "./ip";
import { connectionNetwork } from "./metadata";
import type {
  AddressLookup,
  ConnectionResponse,
  Env,
  NetworkData,
  NetworkResult,
} from "./types";
import { isAsn, isCountryCode, isDnsName, isRecord, isText } from "./validation";

function optionalText(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  if (value === undefined || value === null) return null;
  if (!isText(value)) throw new UpstreamError("invalid_response");
  return value;
}

function parseNetwork(value: unknown, ip: ParsedIp): NetworkData {
  if (!isRecord(value) || parseIp(value.ip)?.value !== ip.value || value.bogon === true) {
    throw new UpstreamError("invalid_response");
  }
  const data: NetworkData = {
    asn: optionalText(value, "asn"),
    organization: optionalText(value, "as_name"),
    domain: optionalText(value, "as_domain"),
    countryCode: optionalText(value, "country_code"),
    country: optionalText(value, "country"),
    continentCode: optionalText(value, "continent_code"),
    continent: optionalText(value, "continent"),
  };
  if (
    (data.asn !== null && !isAsn(data.asn)) ||
    (data.countryCode !== null && !isCountryCode(data.countryCode)) ||
    (data.domain !== null && !isDnsName(data.domain)) ||
    (data.continentCode !== null && !/^(AF|AN|AS|EU|NA|OC|SA)$/.test(data.continentCode)) ||
    Object.values(data).every((field) => field === null)
  ) {
    throw new UpstreamError("invalid_response");
  }
  return data;
}

export async function lookupNetwork(ip: ParsedIp, env: Env): Promise<NetworkResult> {
  if (!ip.isPublic) throw new TypeError("Network lookup requires a public IP address.");
  const token = env.IPINFO_TOKEN?.trim();
  if (!token) return { status: "unavailable", source: "ipinfo", data: null, reason: "missing_token" };
  try {
    const data = await fetchJson(`https://api.ipinfo.io/lite/${encodeURIComponent(ip.value)}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
    return { status: "ok", source: "ipinfo", data: parseNetwork(data, ip), reason: null };
  } catch (error) {
    if (error instanceof UpstreamError) {
      return { status: "error", source: "ipinfo", data: null, reason: error.reason };
    }
    throw error;
  }
}

export async function lookupAddress(
  value: string,
  env: Env,
  connection: ConnectionResponse,
): Promise<AddressLookup> {
  const ip = parsePublicIp(value);
  if (!ip) throw new TypeError("Address lookup requires a public IP address.");
  const [networkResult, dnsResult] = await Promise.allSettled([
    lookupNetwork(ip, env),
    reverseDns(ip.value),
  ]);
  let network: NetworkResult;
  if (networkResult.status === "fulfilled") {
    network = networkResult.value;
  } else {
    console.error("Unexpected network lookup failure.");
    network = { status: "error", source: "ipinfo", data: null, reason: "internal_error" };
  }
  const fallback = connection.ip === ip.value ? connectionNetwork(connection) : null;
  if (network.status !== "ok" && network.status !== "fallback" && fallback) {
    network = { status: "fallback", source: "cloudflare", data: fallback, reason: network.reason };
  }
  if (dnsResult.status === "rejected") console.error("Unexpected DNS lookup failure.");
  return {
    ip: ip.value,
    family: ip.family,
    network,
    reverseDns:
      dnsResult.status === "fulfilled"
        ? dnsResult.value
        : { status: "error", names: [], reason: "internal_error" },
  };
}
