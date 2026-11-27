import { isPseudoIpv4, parseIp } from "./ip";
import type { ConnectionResponse } from "./types";
import { isCountryCode, isText } from "./validation";

function text(value: unknown): string | null {
  return isText(value) ? value : null;
}

export function getConnection(request: Request): ConnectionResponse {
  const primary = parseIp(request.headers.get("CF-Connecting-IP"));
  const overwritten = primary !== null && isPseudoIpv4(primary);
  const ip = overwritten ? parseIp(request.headers.get("CF-Connecting-IPv6"), "ipv6") : primary;
  const added = primary?.family === "ipv6" ? parseIp(request.headers.get("CF-Pseudo-IPv4"), "ipv4") : null;
  const cf = request.cf;
  const asn = cf?.asn;
  return {
    ip: ip?.value ?? null,
    family: ip?.family ?? null,
    ipSource: ip ? (overwritten ? "cf-connecting-ipv6" : "cf-connecting-ip") : null,
    pseudoIpv4: overwritten ? primary.value : added && isPseudoIpv4(added) ? added.value : null,
    reason: ip ? null : overwritten ? "pseudo_ipv4_without_ipv6" : "client_ip_unavailable",
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
