export type Direction = "received" | "sent" | "both";
export type AssetMode = "all" | "include" | "exclude";
export type DestinationType = "webhook" | "ntfy" | "telegram";

export interface Network {
  id: string;
  name: string;
  family: string;
  symbol: string;
  /** Verified USDT contract on this network, or null if none is known. */
  usdt: string | null;
  additionalUsdt?: string[];
}

export interface Rule {
  address: string;
  networks: string[];
  direction: Direction;
  assetMode: AssetMode;
  /** "native", "usdt", "catalog" (see `token`), or a chain-specific token contract. */
  asset: string;
  /** Present when asset is "catalog": a token picked from the server catalog. */
  token?: CatalogToken;
}

export interface CatalogToken {
  id: string;
  symbol: string;
  name: string;
  /** Network id → token contract on that network. */
  contracts: Record<string, string>;
}

export interface TokenSearchResult {
  tokens: CatalogToken[];
  stale: boolean;
  source: string;
}

export type KeyRequirement = "required" | "optional" | "none";

export interface SourceOption {
  id: string;
  name: string;
  description: string;
  key: KeyRequirement;
  /** Provider takes a user-supplied endpoint URL. */
  custom: boolean;
}

export interface NetworkSource {
  network: string;
  /** Active provider id. */
  provider: string;
  hasKey: boolean;
  hasUrl: boolean;
  options: SourceOption[];
}

/** Omitted fields keep the saved value (same provider only); null clears it. */
export interface SourceInput {
  provider: string;
  apiKey?: string | null;
  url?: string | null;
}

export interface WebhookConfig {
  url?: string;
}
export interface NtfyConfig {
  server?: string;
  topic?: string;
  priority?: number;
  token?: string;
}
export interface TelegramConfig {
  botToken?: string;
  chatId?: string;
}
export type DestinationConfig = WebhookConfig & NtfyConfig & TelegramConfig;

export interface Destination {
  id: string;
  name: string;
  type: DestinationType;
  config: Record<string, unknown>;
  rules: Rule[];
}

export interface Delivery {
  id: string;
  destinationName: string;
  destinationId: string;
  status: string;
  summary: string;
  createdAt: string;
  error: string | null;
}

export interface Monitor {
  network: string;
  address: string;
  status: string;
  updatedAt: string | null;
  error: string | null;
}

export interface AppState {
  networks: Network[];
  destinations: Destination[];
  deliveries: Delivery[];
  monitors: Monitor[];
  sources: NetworkSource[];
}

export interface DestinationInput {
  name: string;
  type: DestinationType;
  config: Record<string, unknown>;
  rules: Rule[];
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : res.status === 401
          ? "Your session has ended. Sign in again."
          : `Request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const api = {
  login: (password: string) => request<unknown>("POST", "/api/login", { password }),
  logout: () => request<unknown>("POST", "/api/logout"),
  state: () => request<AppState>("GET", "/api/state"),
  createDestination: (d: DestinationInput) => request<unknown>("POST", "/api/destinations", d),
  updateDestination: (id: string, d: DestinationInput) =>
    request<unknown>("PUT", `/api/destinations/${encodeURIComponent(id)}`, d),
  deleteDestination: (id: string) => request<unknown>("DELETE", `/api/destinations/${encodeURIComponent(id)}`),
  updateSource: (network: string, s: SourceInput) =>
    request<unknown>("PUT", `/api/sources/${encodeURIComponent(network)}`, s),
  searchTokens: (networks: string[], q: string) =>
    request<unknown>(
      "GET",
      `/api/tokens?${new URLSearchParams({ networks: networks.join(","), q }).toString()}`,
    ).then(parseTokenSearch),
  testDestination: (id: string) => request<unknown>("POST", `/api/destinations/${encodeURIComponent(id)}/test`),
};

// Catalog data comes from a third-party source via the server: treat every field as untrusted text.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const t = v.replace(CONTROL, "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

export function parseCatalogToken(v: unknown): CatalogToken | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  if (!id || id.length > 200) return null;
  const contracts: Record<string, string> = {};
  if (o.contracts && typeof o.contracts === "object" && !Array.isArray(o.contracts)) {
    for (const [net, addr] of Object.entries(o.contracts as Record<string, unknown>)) {
      if (typeof addr === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(addr.trim())) contracts[net] = addr.trim();
    }
  }
  return {
    id,
    symbol: cleanText(o.symbol, 24) || "?",
    name: cleanText(o.name, 80),
    contracts,
  };
}

function parseTokenSearch(data: unknown): TokenSearchResult {
  const o = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const tokens = Array.isArray(o.tokens)
    ? (o.tokens.map(parseCatalogToken).filter(Boolean) as CatalogToken[])
    : [];
  return { tokens, stale: o.stale === true, source: cleanText(o.source, 60) };
}
