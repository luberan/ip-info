import type { ConnectionResponse, NetworkData } from "./types";

export function connectionNetwork(connection: ConnectionResponse): NetworkData | null {
  const cf = connection.metadata;
  if (cf.asn === null && cf.asOrganization === null && cf.country === null) return null;
  return {
    asn: cf.asn === null ? null : `AS${cf.asn}`,
    organization: cf.asOrganization,
    domain: null,
    countryCode: cf.country,
    country: null,
    continentCode: null,
    continent: null,
  };
}
