import { fetchJson, UpstreamError } from "../lib/http";
import { parsePublicIp } from "../lib/ip";
import { connectionNetwork } from "../lib/metadata";
import type {
  AddressFamily,
  ConnectionResponse,
  DnsResult,
  FailureReason,
  NetworkResult,
} from "../lib/types";
import { isRecord } from "../lib/validation";
import { parseConnectionResponse, parseLookupResponse } from "./validation";

export const DETECTION_TIMEOUT_MS = 5_000;
const API_TIMEOUT_MS = 7_000;
const endpoints: Record<AddressFamily, string> = {
  ipv4: "https://api.ipify.org?format=json",
  ipv6: "https://api6.ipify.org?format=json",
};
const countryNames = new Intl.DisplayNames(["cs"], { type: "region" });

interface CardState {
  family: AddressFamily;
  ip: string | null;
  detection: "loading" | "success" | "failed" | "fallback";
  failure: FailureReason | null;
  network: NetworkResult | null;
  dns: DnsResult | null;
  enrichmentPending: boolean;
}

interface Run {
  controller: AbortController;
  connection: ConnectionResponse | null;
  connectionLoading: boolean;
  cards: Record<AddressFamily, CardState>;
}

function element(id: string): HTMLElement {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Required page element is missing: ${id}`);
  return result;
}

const root = element("ip-app");
const refreshButton = element("refresh-button");
const copyButtons = [...document.querySelectorAll<HTMLButtonElement>("button[data-copy-target]")];
let current: Run | null = null;

function setValue(id: string, value: string | null, loading = false, copy = false): void {
  const target = element(id);
  target.textContent = loading ? "Načítání…" : value ?? "Nedostupné";
  target.classList.toggle("is-loading", loading);
  if (copy && value !== null && !loading) target.dataset.copyValue = value;
  else delete target.dataset.copyValue;
  for (const button of copyButtons) {
    if (button.dataset.copyTarget !== id) continue;
    button.disabled = !copy || value === null || loading;
    if (button.classList.contains("copy-value")) button.hidden = button.disabled;
  }
}

function countryLabel(code: string | null, name: string | null = null): string | null {
  if (!code) return name;
  const translated = countryNames.of(code);
  return `${translated === code ? name ?? code : translated ?? code} (${code})`;
}

function failureReason(error: unknown): FailureReason {
  if (error instanceof UpstreamError) return error.reason;
  console.error("Neočekávaná chyba při načítání údajů.");
  return "internal_error";
}

function isCurrent(run: Run): boolean {
  return current === run && !run.controller.signal.aborted;
}

function renderCard(run: Run, card: CardState): void {
  const family = card.family;
  const label = family === "ipv4" ? "IPv4" : "IPv6";
  const detecting = card.detection === "loading";
  const loading = detecting || card.enrichmentPending;
  element(`${family}-card`).setAttribute("aria-busy", String(loading));
  setValue(`${family}-address`, card.ip ?? "—", detecting, card.ip !== null);
  if (detecting) element(`${family}-address`).textContent = "Zjišťuji adresu…";
  const status = element(`${family}-status`);
  status.dataset.state = card.detection;
  if (detecting) {
    status.textContent = `Ověřuji ${label}`;
    element(`${family}-note`).textContent = `Nezávislá kontrola přes ${family === "ipv4" ? "api.ipify.org" : "api6.ipify.org"}.`;
  } else if (card.detection === "success") {
    status.textContent = "Ověřeno přes ipify";
    element(`${family}-note`).textContent = `Zdroj adresy: ${family === "ipv4" ? "api.ipify.org" : "api6.ipify.org"}.`;
  } else if (card.detection === "fallback") {
    status.textContent = "Adresa pozorovaná Cloudflare";
    element(`${family}-note`).textContent = `${label} se nepodařilo ověřit přes ipify. Zobrazená adresa pochází přímo ze spojení s Cloudflare.`;
  } else {
    status.textContent = `${label} se nepodařilo ověřit`;
    element(`${family}-note`).textContent =
      card.failure === "timeout"
        ? `Kontrola neodpověděla do 5 sekund. To samo o sobě neprokazuje, že je ${label} vypnuté.`
        : `Příčinou může být síťová chyba nebo blokování služby. To samo o sobě neprokazuje, že je ${label} vypnuté.`;
  }
  let data = card.network?.data ?? null;
  let source = card.network?.source ?? null;
  if (
    !loading &&
    card.ip !== null &&
    card.network?.status !== "ok" &&
    run.connection?.ip === card.ip
  ) {
    const fallback = connectionNetwork(run.connection);
    if (fallback) {
      data = fallback;
      source = "cloudflare";
    }
  }
  setValue(`${family}-organization`, data?.organization ?? null, loading, true);
  setValue(`${family}-asn`, data?.asn ?? null, loading, true);
  setValue(`${family}-domain`, data?.domain ?? null, loading, true);
  setValue(`${family}-country`, data ? countryLabel(data.countryCode, data.country) : null, loading, true);
  const dnsValue =
    card.dns?.status === "ok" ? card.dns.names.join(", ") :
    card.dns?.status === "none" ? "PTR záznam nenalezen" :
    card.dns?.status === "error" ? "DNS dotaz se nezdařil" : null;
  setValue(`${family}-dns`, dnsValue, loading, card.dns?.status === "ok");
  element(`${family}-source`).textContent =
    loading ? "Síťová data a DNS se načítají." :
    card.ip === null ? "Bez zjištěné adresy nejsou síťová data ani DNS dostupné." :
    source === "cloudflare" ? "Síťová data: Cloudflare pro tuto adresu; IPinfo nyní není dostupné. DNS: Cloudflare." :
    card.network?.status === "ok" ? "Síťová data: IPinfo Lite · DNS: Cloudflare" :
    card.network?.reason === "missing_token" ? "IPinfo není v této instalaci nastaveno. DNS: Cloudflare." :
    "Síťová data nyní nejsou dostupná. DNS: Cloudflare.";
}

function renderConnection(run: Run): void {
  const connection = run.connection;
  const loading = run.connectionLoading;
  const cf = connection?.metadata;
  setValue("connection-family", connection?.family === "ipv4" ? "IPv4" : connection?.family === "ipv6" ? "IPv6" : null, loading);
  setValue("connection-ip", connection?.ip ?? null, loading, true);
  setValue("connection-asn", cf?.asn ? `AS${cf.asn}` : null, loading);
  setValue("connection-organization", cf?.asOrganization ?? null, loading);
  setValue("connection-timezone", cf?.timezone ?? null, loading);
  setValue("connection-colo", cf?.colo ?? null, loading);
  setValue("connection-http", cf?.httpProtocol ?? null, loading);
  setValue("connection-tls", cf?.tlsVersion ?? null, loading);
  const location = cf ? [...new Set([cf.city, cf.region, countryLabel(cf.country)].filter((part) => part !== null))].join(" · ") : "";
  setValue("connection-location", location || null, loading);
  element("connection-pseudo-row").hidden = !connection?.pseudoIpv4;
  setValue("connection-pseudo", connection?.pseudoIpv4 ?? null);
  element("connection-source").textContent =
    loading ? "Načítám údaje přímo z Cloudflare…" :
    !connection ? "Dotaz na Cloudflare se nezdařil. Detekce přes ipify probíhá nezávisle." :
    connection.reason === "pseudo_ipv4_without_ipv6" ? "Cloudflare vrátilo pouze Pseudo IPv4; skutečná IPv6 adresa není dostupná." :
    !connection.ip ? "Cloudflare v tomto prostředí neposkytlo adresu klienta. Některá metadata mohou chybět." :
    "Zdroj: Cloudflare · /api/connection · pouze pro toto spojení";
}

async function enrich(run: Run, card: CardState): Promise<void> {
  const ip = card.ip;
  if (ip === null) return;
  card.enrichmentPending = true;
  renderCard(run, card);
  try {
    const data = await fetchJson("/api/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ [card.family]: ip }),
      signal: run.controller.signal,
      cache: "no-store",
      credentials: "omit",
    }, API_TIMEOUT_MS);
    if (!isCurrent(run)) return;
    const result = parseLookupResponse(data, card.family, ip);
    card.network = result.network;
    card.dns = result.reverseDns;
  } catch (error) {
    if (!isCurrent(run)) return;
    const reason = failureReason(error);
    card.network = { status: "error", source: "ipinfo", data: null, reason };
    card.dns = { status: "error", names: [], reason };
  } finally {
    if (isCurrent(run)) {
      card.enrichmentPending = false;
      renderCard(run, card);
    }
  }
}

async function connectionFallback(run: Run, card: CardState): Promise<void> {
  if (!isCurrent(run) || card.detection !== "failed" || card.ip !== null) return;
  const ip = parsePublicIp(run.connection?.ip, card.family);
  if (!ip) return;
  card.ip = ip.value;
  card.detection = "fallback";
  await enrich(run, card);
}

async function loadConnection(run: Run): Promise<void> {
  try {
    const data = await fetchJson("/api/connection", {
      headers: { Accept: "application/json" },
      signal: run.controller.signal,
      cache: "no-store",
      credentials: "omit",
    }, API_TIMEOUT_MS);
    if (!isCurrent(run)) return;
    run.connection = parseConnectionResponse(data);
  } catch (error) {
    if (!isCurrent(run)) return;
    failureReason(error);
  }
  if (!isCurrent(run)) return;
  run.connectionLoading = false;
  renderConnection(run);
  for (const card of Object.values(run.cards)) renderCard(run, card);
  await Promise.allSettled(Object.values(run.cards).map((card) => connectionFallback(run, card)));
}

async function detect(run: Run, card: CardState): Promise<void> {
  try {
    const data = await fetchJson(endpoints[card.family], {
      headers: { Accept: "application/json" },
      signal: run.controller.signal,
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    }, DETECTION_TIMEOUT_MS);
    if (!isCurrent(run)) return;
    const ip = isRecord(data) ? parsePublicIp(data.ip, card.family) : null;
    if (!ip) throw new UpstreamError("invalid_response");
    card.ip = ip.value;
    card.detection = "success";
    await enrich(run, card);
  } catch (error) {
    if (!isCurrent(run)) return;
    card.failure = failureReason(error);
    card.detection = "failed";
    renderCard(run, card);
    await connectionFallback(run, card);
  }
}

function newCard(family: AddressFamily): CardState {
  return { family, ip: null, detection: "loading", failure: null, network: null, dns: null, enrichmentPending: false };
}

export async function refresh(): Promise<void> {
  current?.controller.abort();
  const run: Run = {
    controller: new AbortController(),
    connection: null,
    connectionLoading: true,
    cards: { ipv4: newCard("ipv4"), ipv6: newCard("ipv6") },
  };
  current = run;
  root.dataset.loading = "true";
  refreshButton.setAttribute("aria-busy", "true");
  element("refresh-status").textContent = "Probíhá kontrola připojení…";
  element("copy-feedback").textContent = "";
  renderConnection(run);
  for (const card of Object.values(run.cards)) renderCard(run, card);
  const results = await Promise.allSettled([
    loadConnection(run),
    detect(run, run.cards.ipv4),
    detect(run, run.cards.ipv6),
  ]);
  if (!isCurrent(run)) return;
  root.dataset.loading = "false";
  refreshButton.setAttribute("aria-busy", "false");
  if (results.some((result) => result.status === "rejected")) {
    console.error("Neočekávaná chyba při kontrole připojení.");
    element("refresh-status").textContent = "Kontrola narazila na chybu. Zkuste údaje obnovit.";
  } else {
    const detected = Object.values(run.cards).filter((card) => card.ip !== null).length;
    element("refresh-status").textContent =
      detected === 0 ? "Adresy se nepodařilo zjistit. Zkuste obnovit údaje." :
      detected === 1 ? "Kontrola dokončena · jedna adresa je dostupná" :
      `Aktualizováno v ${new Intl.DateTimeFormat("cs", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date())}`;
  }
}

refreshButton.addEventListener("click", () => { void refresh(); });
for (const button of copyButtons) {
  button.addEventListener("click", async () => {
    const target = button.dataset.copyTarget;
    const value = target ? element(target).dataset.copyValue : undefined;
    if (!value) return;
    const feedback = element("copy-feedback");
    if (!navigator.clipboard?.writeText) {
      feedback.dataset.state = "error";
      feedback.textContent = "Kopírování není v tomto prohlížeči dostupné. Označte a zkopírujte údaj ručně.";
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      feedback.dataset.state = "success";
      feedback.textContent = `${button.dataset.copyLabel ?? "Údaj"}: zkopírováno do schránky.`;
    } catch {
      feedback.dataset.state = "error";
      feedback.textContent = "Údaj se nepodařilo zkopírovat. Zkontrolujte oprávnění schránky nebo jej zkopírujte ručně.";
    }
  });
}

export const initialLoad = refresh();
