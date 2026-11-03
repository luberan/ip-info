import { isPseudoIpv4, parseIp } from "./ip";
import type { ConnectionResponse } from "./types";
import { isCountryCode, isText } from "./validation";

function text(value: unknown): string | null {
  return isText(value) ? value : null;
}

export function getConnection(request: Request): ConnectionResponse {
  const primary = parseIp(request.headers.get("CF-Connecting-IP"));
  const pseudo = primary && isPseudoIpv4(primary) ? primary.value : null;
  const ip = pseudo ? parseIp(request.headers.get("CF-Connecting-IPv6"), "ipv6") : primary;
  const cf = request.cf;
  const asn = cf?.asn;
  return {
    ip: ip?.value ?? null,
    family: ip?.family ?? null,
    ipSource: ip ? (pseudo ? "cf-connecting-ipv6" : "cf-connecting-ip") : null,
    pseudoIpv4: pseudo,
    reason: ip ? null : pseudo ? "pseudo_ipv4_without_ipv6" : "client_ip_unavailable",
    metadata: {
      asn:
        typeof asn === "number" && Number.isInteger(asn) && asn > 0 && asn <= 4_294_967_295
          ? asn
          : null,
      asOrganization: text(cf?.asOrganization),
      country: isCountryCode(cf?.country) ? cf.country : null,
      region: text(cf?.region),
      city: text(cf?.city),
      timezone: text(cf?.timezone),
      colo: text(cf?.colo),
      httpProtocol: text(cf?.httpProtocol),
      tlsVersion: text(cf?.tlsVersion),
    },
  };
}
