import type { FailureReason } from "./types";

export const UPSTREAM_TIMEOUT_MS = 3_500;
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
  if (!body) return "";
  signal?.throwIfAborted();
  const reader = body.getReader();
  let onAbort: (() => void) | undefined;
  const aborted = signal
    ? new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
      })
    : null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  let finished = false;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const chunk = await (aborted ? Promise.race([reader.read(), aborted]) : reader.read());
      if (chunk.done) {
        finished = true;
        break;
      }
      total += chunk.value.byteLength;
      if (total > maxBytes) throw new BodyError("body_too_large");
      chunks.push(chunk.value);
    }
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    if (!finished) await reader.cancel();
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
    if (!response.ok) {
      await response.body?.cancel();
      throw new UpstreamError("http_error");
    }
    if (!["application/json", "application/dns-json"].includes(mediaType(response.headers.get("Content-Type")))) {
      await response.body?.cancel();
      throw new UpstreamError("invalid_response");
    }
    const length = response.headers.get("Content-Length");
    if (length && /^\d+$/.test(length) && Number(length) > MAX_UPSTREAM_BYTES) {
      await response.body?.cancel();
      throw new UpstreamError("invalid_response");
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
