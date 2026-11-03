import { beforeEach, describe, expect, it, vi } from "vitest";
import { reverseDns } from "../src/lib/dns";
import { ptrName } from "../src/lib/ip";
import { dnsResponse, IPV4, IPV6 } from "./fixtures";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); });

describe("Cloudflare DNS over HTTPS", () => {
  it.each([IPV4, IPV6])("uses a fixed endpoint and the correct PTR question for %s", async (ip) => {
    fetchMock.mockResolvedValueOnce(Response.json(dnsResponse(ptrName(ip))));
    expect(await reverseDns(ip)).toEqual({ status: "ok", names: ["resolver.example.net"], reason: null });
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe("https://cloudflare-dns.com/dns-query");
    expect(url.searchParams.get("type")).toBe("PTR");
    expect(url.searchParams.get("name")).toBe(ptrName(ip));
    expect(new Headers(init?.headers).get("Accept")).toBe("application/dns-json");
  });

  it("returns multiple PTR answers without duplicate names or root dots", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({
      Status: 0,
      Answer: [
        { name: ptrName(IPV4), type: 12, data: "First.example.net." },
        { name: ptrName(IPV4), type: 12, data: "second.example.net." },
        { name: ptrName(IPV4), type: 12, data: "first.example.net." },
      ],
    }));
    expect(await reverseDns(IPV4)).toEqual({
      status: "ok", names: ["first.example.net", "second.example.net"], reason: null,
    });
  });

  it.each([
    { Status: 3 }, { Status: 0 }, { Status: 0, Answer: [] },
    { Status: 0, Answer: [{ name: ptrName(IPV4), type: 5, data: "alias.example.net." }] },
  ])("distinguishes absent PTR records from failures", async (response) => {
    fetchMock.mockResolvedValueOnce(Response.json(response));
    expect(await reverseDns(IPV4)).toEqual({ status: "none", names: [], reason: null });
  });

  it.each([
    [{ Status: 2 }, "dns_error"],
    [{ Status: "0" }, "invalid_response"],
    [{ Status: 0, TC: true }, "invalid_response"],
    [{ Status: 0, Answer: "invalid" }, "invalid_response"],
    [{ Status: 0, Answer: [{ type: 12, name: ptrName(IPV4), data: "<script>bad</script>" }] }, "invalid_response"],
    [{ Status: 0, Answer: [{ type: "12", name: ptrName(IPV4), data: "example.net." }] }, "invalid_response"],
  ])("reports DNS errors or malformed data separately", async (response, reason) => {
    fetchMock.mockResolvedValueOnce(Response.json(response));
    expect(await reverseDns(IPV4)).toEqual({ status: "error", names: [], reason });
  });

  it("reports HTTP failures instead of pretending there is no PTR record", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 503 }));
    expect(await reverseDns(IPV4)).toEqual({ status: "error", names: [], reason: "http_error" });
  });

  it("does not send malformed or private addresses upstream", async () => {
    await expect(reverseDns("127.0.0.1")).rejects.toThrow(TypeError);
    await expect(reverseDns("not-an-ip")).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
