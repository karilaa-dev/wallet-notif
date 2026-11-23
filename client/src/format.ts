import type { BadgeVariant } from "@cloudflare/kumo";
import { cleanText, type AssetMode, type Direction, type DestinationType, type Network, type Rule } from "./api";

export type Tone = "success" | "error" | "warning" | "neutral";

/** Map a free-form backend status string onto a visual tone. */
export function statusTone(status: string | null | undefined): Tone {
  const s = (status ?? "").toLowerCase();
  if (/(fail|error|down|stopp|dead|reject|invalid)/.test(s)) return "error";
  if (/(pend|queue|retry|start|connect|sync|backoff|warn|stale|degrad|wait)/.test(s)) return "warning";
  if (/(ok|sent|deliver|success|live|running|active|healthy|watching|up|idle|ready)/.test(s)) return "success";
  return "neutral";
}

export function toneBadge(tone: Tone): BadgeVariant {
  return tone;
}

export function humanize(s: string): string {
  if (!s) return "Unknown";
  const t = s.replace(/[_-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }) : null;
const dtf = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });

export function parseTime(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  const d = parseTime(iso);
  if (!d) return "Never";
  const diff = (d.getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (!rtf) return d.toLocaleString();
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), "day");
  return d.toLocaleDateString();
}

export function absoluteTime(iso: string | null | undefined): string {
  const d = parseTime(iso);
  return d ? dtf.format(d) : "";
}

export function shortAddress(a: string, head = 6, tail = 4): string {
  if (a.length <= head + tail + 1) return a;
  return `${a.slice(0, head)}…${a.slice(-tail)}`;
}

export const DIRECTION_LABEL: Record<Direction, string> = {
  received: "Received",
  sent: "Sent",
  both: "Sent and received",
};

export const ASSET_MODE_LABEL: Record<AssetMode, string> = {
  all: "All assets",
  include: "Only",
  exclude: "All except",
};

export const TYPE_LABEL: Record<DestinationType, string> = {
  webhook: "Webhook",
  ntfy: "ntfy",
  telegram: "Telegram",
};

export function familyLabel(family: string): string {
  const f = family.toLowerCase();
  const known: Record<string, string> = {
    evm: "EVM",
    ethereum: "EVM",
    tron: "Tron",
    solana: "Solana",
    bitcoin: "Bitcoin",
    btc: "Bitcoin",
    utxo: "UTXO",
    ton: "TON",
    cosmos: "Cosmos",
  };
  return known[f] ?? humanize(family);
}

/** Describe the asset filter of a rule in plain words. */
export function describeAsset(rule: Rule, networks: Network[]): string {
  if (rule.assetMode === "all") return "All assets";
  const prefix = rule.assetMode === "include" ? "Only" : "All except";
  if (rule.asset.trim().toLowerCase() === "catalog") {
    const sym = cleanText(rule.token?.symbol, 24);
    return `${prefix} ${sym || "catalog token"}`;
  }
  return `${prefix} ${assetLabel(rule.asset, networks)}`;
}

export function assetLabel(asset: string, networks: Network[]): string {
  const a = asset.trim();
  if (a.toLowerCase() === "native") {
    const symbols = [...new Set(networks.map((n) => n.symbol).filter(Boolean))];
    return symbols.length ? `native ${symbols.join("/")}` : "native coin";
  }
  if (a.toLowerCase() === "usdt") return "USDT";
  const match = networks.find((n) => n.usdt === a || n.additionalUsdt?.includes(a));
  if (match) return "USDT";
  return shortAddress(a, 8, 6);
}

/** Lightweight shape check per chain family. Returns a hint string, or null if it looks fine / unknown. */
export function addressHint(address: string, family: string | null): string | null {
  const a = address.trim();
  if (!a || !family) return null;
  const f = family.toLowerCase();
  if (f === "evm" || f === "ethereum") {
    return /^0x[0-9a-fA-F]{40}$/.test(a) ? null : "EVM addresses are 0x followed by 40 hex characters.";
  }
  if (f === "tron") {
    return /^(?:T[1-9A-HJ-NP-Za-km-z]{33}|41[0-9a-fA-F]{40})$/.test(a)
      ? null : "Enter a TRON base58 address or a 41-prefixed hex address.";
  }
  return null;
}

/** Guess the chain family from an address so we can suggest networks. */
export function guessFamily(address: string, families: string[]): string | null {
  const a = address.trim();
  const has = (f: string) => families.find((x) => x.toLowerCase() === f) ?? null;
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return has("evm") ?? has("ethereum");
  if (/^(?:T[1-9A-HJ-NP-Za-km-z]{33}|41[0-9a-fA-F]{40})$/.test(a)) return has("tron");
  if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(a)) return has("bitcoin") ?? has("btc") ?? has("utxo");
  if (/^(?:-?\d+:[0-9A-Fa-f]{64}|[EU]Q[\w-]{46})$/.test(a)) return has("ton");
  return null;
}
