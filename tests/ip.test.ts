import { describe, expect, it } from "vitest";
import { isPseudoIpv4, parseIp, parsePublicIp, ptrName } from "../src/lib/ip";

describe("strict IP parsing", () => {
  it.each(["8.8.8.8", "1.1.1.1", "9.9.9.9", "185.199.108.153"])("accepts public IPv4 %s", (ip) => {
    expect(parsePublicIp(ip)).toMatchObject({ value: ip, family: "ipv4", isPublic: true });
  });

  it.each([
    "2001:4860:4860::8888", "2606:4700:4700::1111", "2a00:1450:4001:801::200e",
    "2001:4860::8.8.8.8",
  ])("accepts public IPv6 %s", (ip) => {
    expect(parsePublicIp(ip)).toMatchObject({ family: "ipv6", isPublic: true });
  });

  it("normalizes compressed, expanded, and uppercase IPv6 consistently", () => {
    expect(parseIp("2001:4860:0000:0000:0000:0000:0000:8888")?.value).toBe("2001:4860::8888");
    expect(parseIp("2A00:1450:4001:0801:0:0:0:200E")?.value).toBe("2a00:1450:4001:801::200e");
    expect(parseIp("2001:4860::8.8.8.8")?.value).toBe("2001:4860::808:808");
  });

  it.each([
    "", "1", "1.2.3", "127.1", "256.1.1.1", "1.2.3.4.5", "01.2.3.4",
    "0177.0.0.1", "0x7f.0.0.1", "0x08080808", " 8.8.8.8", "8.8.8.8 ",
    "8.8.8.8:443", "https://8.8.8.8", "1.1.1.-1", "1.2.3.4\n",
    "[2001:4860::1]", "fe80::1%eth0", "fe80::1%25eth0", "2001:::1",
    "2001::4860::1", "gggg::1", "1:2:3:4:5:6:7:8:9", "::ffff:010.1.1.1",
    "2001:4860::999.1.1.1", null, 123, ["8.8.8.8"],
  ])("rejects malformed or ambiguous address %j", (ip) => {
    expect(parseIp(ip)).toBeNull();
  });

  it.each([
    "0.0.0.0", "0.8.8.8", "10.0.0.1", "127.0.0.1", "169.254.1.1",
    "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "100.127.255.255",
    "192.0.0.9", "192.0.2.1", "192.88.99.1", "198.18.0.1", "198.51.100.1",
    "203.0.113.1", "224.0.0.1", "240.0.0.1", "255.255.255.255",
    "::", "::1", "fc00::1", "fd00::1", "fe80::1", "ff02::1", "4000::1",
    "64:ff9b::808:808", "::ffff:8.8.8.8", "::ffff:127.0.0.1",
    "2001:db8::1", "2001:20::1", "3fff:1::1", "2002:808:808::1",
  ])("rejects non-public or special-purpose address %s for enrichment", (ip) => {
    expect(parseIp(ip)).not.toBeNull();
    expect(parsePublicIp(ip)).toBeNull();
  });

  it("enforces the requested address family", () => {
    expect(parsePublicIp("8.8.8.8", "ipv6")).toBeNull();
    expect(parsePublicIp("2001:4860::1", "ipv4")).toBeNull();
  });

  it("identifies Cloudflare Class E Pseudo IPv4 addresses", () => {
    const pseudo = parseIp("240.1.2.3");
    const normal = parseIp("8.8.8.8");
    expect(pseudo && isPseudoIpv4(pseudo)).toBe(true);
    expect(normal && isPseudoIpv4(normal)).toBe(false);
  });
});

describe("reverse DNS names", () => {
  it("reverses IPv4 octets", () => {
    expect(ptrName("1.2.3.4")).toBe("4.3.2.1.in-addr.arpa");
    expect(ptrName("8.8.4.4")).toBe("4.4.8.8.in-addr.arpa");
  });

  it.each(["2001:db8::8:800:200c:417a", "2001:db8:0:0:8:800:200c:417a"])(
    "expands and reverses all 32 IPv6 nibbles for %s",
    (ip) => {
      expect(ptrName(ip)).toBe([
        "a.7.1.4", "c.0.0.2", "0.0.8.0", "8.0.0.0",
        "0.0.0.0", "0.0.0.0", "8.b.d.0", "1.0.0.2", "ip6.arpa",
      ].join("."));
    },
  );

  it("handles leading compression", () => {
    expect(ptrName("::1")).toBe([
      "1.0.0.0", "0.0.0.0", "0.0.0.0", "0.0.0.0",
      "0.0.0.0", "0.0.0.0", "0.0.0.0", "0.0.0.0", "ip6.arpa",
    ].join("."));
  });

  it("handles embedded IPv4 without dropping any nibbles", () => {
    expect(ptrName("::ffff:192.0.2.128")).toBe([
      "0.8.2.0", "0.0.0.c", "f.f.f.f", "0.0.0.0",
      "0.0.0.0", "0.0.0.0", "0.0.0.0", "0.0.0.0", "ip6.arpa",
    ].join("."));
  });

  it("rejects invalid addresses rather than constructing a DNS query", () => {
    expect(() => ptrName("1.2.3.999")).toThrow(TypeError);
    expect(() => ptrName("example.net")).toThrow(TypeError);
  });
});
