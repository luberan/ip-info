import { parseIp } from "../src/lib/ip";
import type {
  ConnectionMetadata,
  ConnectionResponse,
  DnsResult,
  LookupResponse,
  NetworkData,
  NetworkResult,
} from "../src/lib/types";

export const IPV4 = "8.8.8.8";
export const IPV6 = "2001:4860:4860::8888";

export function networkData(overrides: Partial<NetworkData> = {}): NetworkData {
  return {
    asn: "AS15169",
    organization: "Test network",
    domain: "example.net",
    countryCode: "CZ",
    country: "Czechia",
    continentCode: "EU",
    continent: "Europe",
    ...overrides,
  };
}

export function connection(
  value: string | null = IPV4,
  metadata: Partial<ConnectionMetadata> = {},
): ConnectionResponse {
  const ip = parseIp(value);
  return {
    ip: ip?.value ?? null,
    family: ip?.family ?? null,
    ipSource: ip ? "cf-connecting-ip" : null,
    pseudoIpv4: null,
    reason: ip ? null : "client_ip_unavailable",
    metadata: {
      asn: null,
      asOrganization: null,
      country: null,
      region: null,
      city: null,
      timezone: null,
      colo: null,
      httpProtocol: null,
      tlsVersion: null,
      ...metadata,
    },
  };
}

export function lookupResponse(
  value: string,
  network: NetworkResult = { status: "ok", source: "ipinfo", data: networkData(), reason: null },
  reverseDns: DnsResult = { status: "ok", names: ["resolver.example.net"], reason: null },
): LookupResponse {
  const ip = parseIp(value);
  if (!ip) throw new Error("The test fixture requires a valid IP address.");
  return {
    ipv4: null,
    ipv6: null,
    [ip.family]: { ip: ip.value, family: ip.family, network, reverseDns },
  };
}

export function ipinfoResponse(ip: string): Record<string, unknown> {
  return {
    ip,
    asn: "AS15169",
    as_name: "Test network",
    as_domain: "example.net",
    country_code: "CZ",
    country: "Czechia",
    continent_code: "EU",
    continent: "Europe",
  };
}

export function dnsResponse(name: string): Record<string, unknown> {
  return {
    Status: 0,
    Answer: [{ name, type: 12, TTL: 300, data: "resolver.example.net." }],
  };
}
