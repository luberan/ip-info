import type { FailureReason } from "./types";

export const UPSTREAM_TIMEOUT_MS = 3_500;
export const REQUEST_BODY_TIMEOUT_MS = 5_000;
export const MAX_REQUEST_BYTES = 1_024;
export const MAX_UPSTREAM_BYTES = 32_768;

export class UpstreamError extends Error {
  constructor(public readonly reason: FailureReason) {
    super(reason);
    this.name = "UpstreamError";
  }
}

export class BodyError extends Error {
  constructor(public readonly code: "body_too_large" | "invalid_encoding") {
    super(code);
    this.name = "BodyError";
  }
}

export function mediaType(header: string | null): string {
  return header?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export async function readTextLimited(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  if (!body) return "";
  const reader = body.getReader();
  // Canceling settles pending reads immediately. The source's cleanup can take longer.
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      signal?.throwIfAborted();
      if (chunk.done) break;
      if (chunk.value.byteLength === 0) continue;
      total += chunk.value.byteLength;
      if (total > maxBytes) throw new BodyError("body_too_large");
      chunks.push(chunk.value);
    }
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) throw new BodyError("invalid_encoding");
    throw error;
  }
}

export async function fetchJson(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs = UPSTREAM_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController();
  const parent = init.signal;
  const abort = () => controller.abort();
  if (parent?.aborted) throw new UpstreamError("aborted");
  parent?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    // Workers reject redirect: "error"; manual 3xx responses are rejected below.
    const response = await fetch(url, { ...init, signal: controller.signal, redirect: "manual" });
    const length = response.headers.get("Content-Length");
    const type = mediaType(response.headers.get("Content-Type"));
    const isJson = type === "application/json" || type === "application/dns-json";
    const oversized = length !== null && /^\d+$/.test(length) && Number(length) > MAX_UPSTREAM_BYTES;
    if (!response.ok || !isJson || oversized) {
      void response.body?.cancel().catch(() => {});
      throw new UpstreamError(response.ok ? "invalid_response" : "http_error");
    }
    const text = await readTextLimited(response.body, MAX_UPSTREAM_BYTES, controller.signal);
    try {
      return JSON.parse(text);
    } catch (error) {
      if (error instanceof SyntaxError) throw new UpstreamError("invalid_response");
      throw error;
    }
  } catch (error) {
    if (parent?.aborted) throw new UpstreamError("aborted");
    if (timedOut) throw new UpstreamError("timeout");
    if (error instanceof UpstreamError) throw error;
    if (error instanceof BodyError) throw new UpstreamError("invalid_response");
    if (error instanceof TypeError || error instanceof DOMException) {
      throw new UpstreamError("network_error");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
  }
}
