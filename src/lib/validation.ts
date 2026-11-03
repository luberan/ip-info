export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isText(value: unknown, maxLength = 200): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function isCountryCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{2}$/.test(value) && value !== "XX";
}

export function isAsn(value: unknown): value is string {
  if (typeof value !== "string" || !/^AS[1-9]\d{0,9}$/.test(value)) return false;
  return Number(value.slice(2)) <= 4_294_967_295;
}

export function isDnsName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const name = value.endsWith(".") ? value.slice(0, -1) : value;
  return (
    name.length > 0 &&
    name.length <= 253 &&
    name.split(".").every((label) => /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/i.test(label))
  );
}
