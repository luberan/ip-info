import { getConnection } from "./lib/connection";
import { BodyError, MAX_REQUEST_BYTES, mediaType, readTextLimited } from "./lib/http";
import { parsePublicIp } from "./lib/ip";
import { lookupAddress } from "./lib/lookup";
import { ApiError, errorResponse, jsonResponse } from "./lib/response";
import type { AddressFamily, Env, LookupResponse } from "./lib/types";
import { isRecord } from "./lib/validation";

async function readLookupBody(request: Request): Promise<Partial<Record<AddressFamily, string>>> {
  if (mediaType(request.headers.get("Content-Type")) !== "application/json") {
    throw new ApiError(415, "unsupported_media_type", "Use application/json.");
  }
  const encoding = request.headers.get("Content-Encoding");
  if (encoding && encoding.toLowerCase() !== "identity") {
    throw new ApiError(415, "unsupported_encoding", "Compressed request bodies are not accepted.");
  }
  const length = request.headers.get("Content-Length");
  if (length !== null && !/^\d+$/.test(length)) {
    throw new ApiError(400, "invalid_content_length", "Content-Length must be a decimal byte count.");
  }
  if (length !== null && Number(length) > MAX_REQUEST_BYTES) {
    throw new ApiError(413, "body_too_large", "The request body must not exceed 1024 bytes.");
  }
  let body: unknown;
  try {
    body = JSON.parse(await readTextLimited(request.body, MAX_REQUEST_BYTES));
  } catch (error) {
    if (error instanceof BodyError) {
      throw new ApiError(
        error.code === "body_too_large" ? 413 : 400,
        error.code,
        error.code === "body_too_large" ? "The request body must not exceed 1024 bytes." : "Use UTF-8 JSON.",
      );
    }
    if (error instanceof SyntaxError) throw new ApiError(400, "invalid_json", "The request body is not valid JSON.");
    throw error;
  }
  if (!isRecord(body) || Object.keys(body).some((key) => key !== "ipv4" && key !== "ipv6")) {
    throw new ApiError(400, "invalid_body", "Provide only optional ipv4 and ipv6 string fields.");
  }
  const result: Partial<Record<AddressFamily, string>> = {};
  for (const family of ["ipv4", "ipv6"] as const) {
    if (body[family] === undefined) continue;
    const ip = parsePublicIp(body[family], family);
    if (!ip) throw new ApiError(400, "invalid_ip", `The ${family} field must contain a public ${family} address.`);
    result[family] = ip.value;
  }
  if (!result.ipv4 && !result.ipv6) {
    throw new ApiError(400, "empty_lookup", "Provide at least one public IP address.");
  }
  return result;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const expectedMethod =
      url.pathname === "/api/connection" ? "GET" : url.pathname === "/api/lookup" ? "POST" : null;
    if (!expectedMethod) return errorResponse(new ApiError(404, "not_found", "Endpoint not found."));
    if (request.method !== expectedMethod) {
      return errorResponse(new ApiError(405, "method_not_allowed", `Use ${expectedMethod}.`), {
        Allow: expectedMethod,
      });
    }
    try {
      if (url.pathname === "/api/connection") return jsonResponse(getConnection(request));
      const origin = request.headers.get("Origin");
      const fetchSite = request.headers.get("Sec-Fetch-Site");
      if (
        (origin !== null && origin !== url.origin) ||
        (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none")
      ) {
        throw new ApiError(403, "cross_origin_denied", "Cross-origin lookup requests are not allowed.");
      }
      const ips = await readLookupBody(request);
      const connection = getConnection(request);
      const [ipv4, ipv6] = await Promise.all([
        ips.ipv4 ? lookupAddress(ips.ipv4, env, connection) : null,
        ips.ipv6 ? lookupAddress(ips.ipv6, env, connection) : null,
      ]);
      const response: LookupResponse = { ipv4, ipv6 };
      return jsonResponse(response);
    } catch (error) {
      if (error instanceof ApiError) return errorResponse(error);
      console.error("Unexpected API failure.");
      return errorResponse(new ApiError(500, "internal_error", "The request could not be processed."));
    }
  },
} satisfies ExportedHandler<Env>;
