import { afterEach, describe, expect, it, vi } from "vitest";
import { BodyError, fetchJson, MAX_UPSTREAM_BYTES, mediaType, readTextLimited } from "../src/lib/http";

afterEach(() => { vi.useRealTimers(); });

describe("bounded JSON transport", () => {
  it("recognizes JSON media types with parameters", () => {
    expect(mediaType("Application/JSON; charset=utf-8")).toBe("application/json");
    expect(mediaType(null)).toBe("");
  });

  it("measures actual UTF-8 bytes rather than character count", async () => {
    const exact = "ě".repeat(512);
    expect(await readTextLimited(new Response(exact).body, 1024)).toBe(exact);
    await expect(readTextLimited(new Response(`${exact}ě`).body, 1024)).rejects.toMatchObject({
      code: "body_too_large",
    });
  });

  it("limits chunked bodies and cancels the stream when the limit is exceeded", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(700));
        controller.enqueue(new Uint8Array(700));
        controller.enqueue(new Uint8Array(700));
      },
      cancel,
    });
    await expect(readTextLimited(stream, 1024)).rejects.toBeInstanceOf(BodyError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects invalid UTF-8", async () => {
    const body = new Response(new Uint8Array([0xc3, 0x28])).body;
    await expect(readTextLimited(body, 1024)).rejects.toMatchObject({ code: "invalid_encoding" });
  });

  it("uses the Worker-supported manual redirect mode and validates successful JSON", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ value: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchJson("https://example.net/data")).toEqual({ value: 1 });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("rejects a redirect without forwarding credentials to its Location", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, {
      status: 302, headers: { Location: "https://untrusted.example/" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchJson("https://example.net/data", {
      headers: { Authorization: "Bearer unit-test-token" },
    })).rejects.toMatchObject({ reason: "http_error" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.net/data");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it.each([
    [Response.json({}, { status: 503 }), "http_error"],
    [new Response("{}", { headers: { "Content-Type": "text/html" } }), "invalid_response"],
    [new Response("{", { headers: { "Content-Type": "application/json" } }), "invalid_response"],
    [new Response("x".repeat(MAX_UPSTREAM_BYTES + 1), { headers: { "Content-Type": "application/json" } }), "invalid_response"],
    [new Response("{}", { headers: { "Content-Type": "application/json", "Content-Length": String(MAX_UPSTREAM_BYTES + 1) } }), "invalid_response"],
  ])("reports an upstream failure without returning success-shaped data", async (response, reason) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response));
    await expect(fetchJson("https://example.net/data")).rejects.toMatchObject({ reason });
  });

  it("reports transport failures explicitly", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Network failed")));
    await expect(fetchJson("https://example.net/data")).rejects.toMatchObject({ reason: "network_error" });
  });

  it("aborts a stalled fetch at its deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    ));
    const assertion = expect(fetchJson("https://example.net/data", {}, 50)).rejects.toMatchObject({ reason: "timeout" });
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });

  it("also bounds the time spent reading a stalled response body", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("{")); },
      cancel,
    });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(body, {
      headers: { "Content-Type": "application/json" },
    })));
    const assertion = expect(fetchJson("https://example.net/data", {}, 50)).rejects.toMatchObject({ reason: "timeout" });
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("distinguishes caller cancellation from an upstream timeout", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchJson("https://example.net/data", { signal: controller.signal })).rejects.toMatchObject({
      reason: "aborted",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
