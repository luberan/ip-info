export type AddressFamily = "ipv4" | "ipv6";

export type FailureReason =
  | "missing_token"
  | "timeout"
  | "http_error"
  | "network_error"
  | "invalid_response"
  | "dns_error"
  | "internal_error"
  | "aborted";

export interface NetworkData {
  asn: string | null;
  organization: string | null;
  domain: string | null;
  countryCode: string | null;
  country: string | null;
  continentCode: string | null;
  continent: string | null;
}

export type NetworkResult =
  | { status: "ok"; source: "ipinfo"; data: NetworkData; reason: null }
  | {
      status: "fallback";
      source: "cloudflare";
      data: NetworkData;
      reason: FailureReason;
    }
  | {
      status: "unavailable" | "error";
      source: "ipinfo";
      data: null;
      reason: FailureReason;
    };

export type DnsResult =
  | { status: "ok"; names: string[]; reason: null }
  | { status: "none"; names: []; reason: null }
  | { status: "error"; names: []; reason: FailureReason };

export interface AddressLookup {
  ip: string;
  family: AddressFamily;
  network: NetworkResult;
  reverseDns: DnsResult;
}

export interface LookupResponse {
  ipv4: AddressLookup | null;
  ipv6: AddressLookup | null;
}

export interface ConnectionMetadata {
  asn: number | null;
  asOrganization: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  colo: string | null;
  httpProtocol: string | null;
  tlsVersion: string | null;
}

export interface ConnectionResponse {
  ip: string | null;
  family: AddressFamily | null;
  ipSource: "cf-connecting-ip" | "cf-connecting-ipv6" | null;
  pseudoIpv4: string | null;
  reason: "client_ip_unavailable" | "pseudo_ipv4_without_ipv6" | null;
  metadata: ConnectionMetadata;
}

export interface Env {
  IPINFO_TOKEN?: string;
}
