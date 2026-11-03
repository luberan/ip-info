import { UpstreamError } from "../lib/http";
import { isPseudoIpv4, parseIp, parsePublicIp } from "../lib/ip";
import type {
  AddressFamily,
  AddressLookup,
  ConnectionResponse,
  DnsResult,
  FailureReason,
  NetworkData,
  NetworkResult,
} from "../lib/types";
import { isAsn, isCountryCode, isDnsName, isRecord, isText } from "../lib/validation";

function nullableText(value: unknown): value is string | null {
  return value === null || isText(value);
}

function isReason(value: unknown): value is FailureReason {
  return [
    "missing_token", "timeout", "http_error", "network_error",
    "invalid_response", "dns_error", "internal_error", "aborted",
  ].some((reason) => reason === value);
}

function isNetworkData(value: unknown): value is NetworkData {
  return (
    isRecord(value) &&
    (value.asn === null || isAsn(value.asn)) &&
    nullableText(value.organization) &&
    (value.domain === null || isDnsName(value.domain)) &&
    (value.countryCode === null || isCountryCode(value.countryCode)) &&
    nullableText(value.country) &&
    (value.continentCode === null ||
      (typeof value.continentCode === "string" && /^(AF|AN|AS|EU|NA|OC|SA)$/.test(value.continentCode))) &&
    nullableText(value.continent) &&
    [
      value.asn, value.organization, value.domain, value.countryCode,
      value.country, value.continentCode, value.continent,
    ].some((field) => field !== null)
  );
}

function isNetworkResult(value: unknown): value is NetworkResult {
  if (!isRecord(value)) return false;
  if (value.status === "ok") {
    return value.source === "ipinfo" && value.reason === null && isNetworkData(value.data);
  }
  if (value.status === "fallback") {
    return value.source === "cloudflare" && isReason(value.reason) && isNetworkData(value.data);
  }
  return (
    (value.status === "error" || value.status === "unavailable") &&
    value.source === "ipinfo" &&
    value.data === null &&
    isReason(value.reason)
  );
}

function isDnsResult(value: unknown): value is DnsResult {
  if (!isRecord(value) || !Array.isArray(value.names) || value.names.length > 64) return false;
  if (value.status === "ok") {
    return value.reason === null && value.names.length > 0 && value.names.every(isDnsName);
  }
  if (value.status === "none") return value.names.length === 0 && value.reason === null;
  return value.status === "error" && value.names.length === 0 && isReason(value.reason);
}

export function parseConnectionResponse(value: unknown): ConnectionResponse {
  if (!isRecord(value) || !isRecord(value.metadata)) throw new UpstreamError("invalid_response");
  const cf = value.metadata;
  const validMetadata =
    (cf.asn === null ||
      (typeof cf.asn === "number" && Number.isInteger(cf.asn) && cf.asn > 0 && cf.asn <= 4_294_967_295)) &&
    nullableText(cf.asOrganization) &&
    (cf.country === null || isCountryCode(cf.country)) &&
    nullableText(cf.region) && nullableText(cf.city) && nullableText(cf.timezone) &&
    nullableText(cf.colo) && nullableText(cf.httpProtocol) && nullableText(cf.tlsVersion);
  const ip = parseIp(value.ip);
  const pseudo = parseIp(value.pseudoIpv4, "ipv4");
  const validPseudo = value.pseudoIpv4 === null || (pseudo !== null && isPseudoIpv4(pseudo));
  const validAddress = ip
    ? ip.value === value.ip &&
      ip.family === value.family &&
      value.reason === null &&
      ((value.ipSource === "cf-connecting-ip" && value.pseudoIpv4 === null) ||
        (value.ipSource === "cf-connecting-ipv6" && ip.family === "ipv6" && pseudo !== null))
    : value.ip === null &&
      value.family === null &&
      value.ipSource === null &&
      ((value.reason === "client_ip_unavailable" && value.pseudoIpv4 === null) ||
        (value.reason === "pseudo_ipv4_without_ipv6" && pseudo !== null));
  if (!validMetadata || !validPseudo || !validAddress) throw new UpstreamError("invalid_response");
  return {
    ip: ip?.value ?? null,
    family: ip?.family ?? null,
    ipSource: ip ? (pseudo ? "cf-connecting-ipv6" : "cf-connecting-ip") : null,
    pseudoIpv4: pseudo?.value ?? null,
    reason: ip ? null : pseudo ? "pseudo_ipv4_without_ipv6" : "client_ip_unavailable",
    metadata: {
      asn: typeof cf.asn === "number" ? cf.asn : null,
      asOrganization: typeof cf.asOrganization === "string" ? cf.asOrganization : null,
      country: typeof cf.country === "string" ? cf.country : null,
      region: typeof cf.region === "string" ? cf.region : null,
      city: typeof cf.city === "string" ? cf.city : null,
      timezone: typeof cf.timezone === "string" ? cf.timezone : null,
      colo: typeof cf.colo === "string" ? cf.colo : null,
      httpProtocol: typeof cf.httpProtocol === "string" ? cf.httpProtocol : null,
      tlsVersion: typeof cf.tlsVersion === "string" ? cf.tlsVersion : null,
    },
  };
}

export function parseLookupResponse(value: unknown, family: AddressFamily, ip: string): AddressLookup {
  if (!isRecord(value) || value[family === "ipv4" ? "ipv6" : "ipv4"] !== null) {
    throw new UpstreamError("invalid_response");
  }
  const result = value[family];
  if (
    !isRecord(result) ||
    result.family !== family ||
    parsePublicIp(result.ip, family)?.value !== ip ||
    !isNetworkResult(result.network) ||
    !isDnsResult(result.reverseDns)
  ) {
    throw new UpstreamError("invalid_response");
  }
  return { ip, family, network: result.network, reverseDns: result.reverseDns };
}
