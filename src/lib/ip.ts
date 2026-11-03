/*!
 * Bundled dependency notice: ipaddr.js (MIT)
 * Copyright (C) 2011-2017 whitequark <whitequark@whitequark.org>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
import ipaddr from "ipaddr.js";
import type { AddressFamily } from "./types";

export interface ParsedIp {
  value: string;
  family: AddressFamily;
  address: ipaddr.IPv4 | ipaddr.IPv6;
  isPublic: boolean;
}

const strictIpv4 = /^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/;
const ipv4Exclusions = ["192.0.0.0/24", "192.88.99.0/24"].map((cidr) =>
  ipaddr.IPv4.parseCIDR(cidr),
);
const ipv6Exclusions = ["2001::/23", "2001:db8::/32", "3fff::/20"].map((cidr) =>
  ipaddr.IPv6.parseCIDR(cidr),
);
const globalIpv6 = ipaddr.IPv6.parseCIDR("2000::/3");
const pseudoIpv4 = ipaddr.IPv4.parseCIDR("240.0.0.0/4");

export function parseIp(value: unknown, expectedFamily?: AddressFamily): ParsedIp | null {
  if (typeof value !== "string" || value.length > 45 || value.length === 0) return null;
  const isV6 = value.includes(":");
  if (isV6) {
    if (!/^[a-f0-9:.]+$/i.test(value)) return null;
    if (value.includes(".") && !strictIpv4.test(value.slice(value.lastIndexOf(":") + 1))) {
      return null;
    }
  } else if (!strictIpv4.test(value)) {
    return null;
  }
  if (!ipaddr.isValid(value)) return null;
  const address = ipaddr.parse(value);
  const family: AddressFamily = address.kind() === "ipv4" ? "ipv4" : "ipv6";
  if (expectedFamily && family !== expectedFamily) return null;
  if (address instanceof ipaddr.IPv4) {
    return {
      value: address.toString(),
      family,
      address,
      isPublic: address.range() === "unicast" && !ipv4Exclusions.some((cidr) => address.match(cidr)),
    };
  }
  return {
    value: address.toRFC5952String(),
    family,
    address,
    isPublic:
      address.range() === "unicast" &&
      address.match(globalIpv6) &&
      !ipv6Exclusions.some((cidr) => address.match(cidr)),
  };
}

export function parsePublicIp(value: unknown, family?: AddressFamily): ParsedIp | null {
  const ip = parseIp(value, family);
  return ip?.isPublic ? ip : null;
}

export function isPseudoIpv4(ip: ParsedIp): boolean {
  return ip.address instanceof ipaddr.IPv4 && ip.address.match(pseudoIpv4);
}

export function ptrName(value: string): string {
  const ip = parseIp(value);
  if (!ip) throw new TypeError("Invalid IP address.");
  if (ip.family === "ipv4") return `${ip.value.split(".").reverse().join(".")}.in-addr.arpa`;
  const nibbles = ip.address
    .toByteArray()
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${nibbles.split("").reverse().join(".")}.ip6.arpa`;
}
