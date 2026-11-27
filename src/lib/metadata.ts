import type { ConnectionResponse, NetworkData } from "./types";

export function connectionNetwork(
  connection: ConnectionResponse,
  lookupFallback: NetworkData | null = null,
): NetworkData | null {
  const cf = connection.metadata;
  const asn = lookupFallback?.asn ?? (cf.asn === null ? null : `AS${cf.asn}`);
  const organization = lookupFallback?.organization ?? cf.asOrganization;
  const countryCode = lookupFallback?.countryCode ?? cf.country;
  if (asn === null && organization === null && countryCode === null) return null;
  return {
    asn,
    organization,
    domain: null,
    countryCode,
    country: null,
    continentCode: null,
    continent: null,
  };
}
