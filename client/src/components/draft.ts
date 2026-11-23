import { parseCatalogToken, type AssetMode, type CatalogToken, type Destination, type DestinationInput, type DestinationType, type Direction, type Network, type Rule } from "../api";
import { addressHint } from "../format";

export type AssetKind = "native" | "usdt" | "contract" | "catalog";

export interface RuleDraft {
  key: string;
  address: string;
  networks: string[];
  direction: Direction;
  assetMode: AssetMode;
  assetKind: AssetKind;
  contract: string;
  /** Catalog token match. Kept while switching asset options so it survives toggling back. */
  token: CatalogToken | null;
  /** Set when a network change dropped the token match; prompts a fresh lookup. */
  tokenNotice: string | null;
  /** Search prefill after a match was dropped. */
  tokenHint: string;
}

export interface Draft {
  name: string;
  type: DestinationType;
  url: string;
  server: string;
  topic: string;
  priority: number;
  token: string;
  clearToken: boolean;
  botToken: string;
  chatId: string;
  rules: RuleDraft[];
}

export type ConfigField = "url" | "server" | "topic" | "token" | "botToken" | "chatId";

export const DEFAULT_NTFY_SERVER = "https://ntfy.sh";

let seq = 0;
const nextKey = () => `r${++seq}`;

export function emptyRule(): RuleDraft {
  return {
    key: nextKey(),
    address: "",
    networks: [],
    direction: "received",
    assetMode: "all",
    assetKind: "native",
    contract: "",
    token: null,
    tokenNotice: null,
    tokenHint: "",
  };
}

/** Networks in `ids` that the token has no contract for. */
export function uncoveredNetworks(token: CatalogToken | null, ids: string[]): string[] {
  if (!token) return ids;
  return ids.filter((id) => !token.contracts[id]);
}

/**
 * Apply a network selection change. A catalog match only stays valid while it has a
 * contract on every selected network; otherwise drop it so the user must look it up again.
 */
export function withNetworks(rule: RuleDraft, next: string[], networks: Network[]): Partial<RuleDraft> {
  const patch: Partial<RuleDraft> = { networks: next };
  if (rule.token && uncoveredNetworks(rule.token, next).length) {
    const names = uncoveredNetworks(rule.token, next).map((id) => networks.find((n) => n.id === id)?.name ?? id);
    patch.token = null;
    patch.tokenHint = rule.token.symbol;
    patch.tokenNotice = `${rule.token.symbol} wasn't matched on ${names.join(", ")}. Search again for the new networks.`;
  }
  return patch;
}

export function ruleToDraft(r: Rule): RuleDraft {
  const asset = (r.asset ?? "native").trim();
  let assetKind: AssetKind = "contract";
  if (asset.toLowerCase() === "native" || asset === "") assetKind = "native";
  else if (asset.toLowerCase() === "usdt") assetKind = "usdt";
  const token = asset.toLowerCase() === "catalog" ? parseCatalogToken(r.token) : null;
  if (asset.toLowerCase() === "catalog") assetKind = "catalog";
  return {
    key: nextKey(),
    address: r.address ?? "",
    networks: [...(r.networks ?? [])],
    direction: r.direction ?? "received",
    assetMode: r.assetMode ?? "all",
    assetKind,
    contract: assetKind === "contract" ? asset : "",
    token,
    tokenNotice: assetKind === "catalog" && !token ? "The saved token couldn't be read. Search for it again." : null,
    tokenHint: "",
  };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function destinationToDraft(d: Destination | null): Draft {
  if (!d) {
    return {
      name: "",
      type: "ntfy",
      url: "",
      server: DEFAULT_NTFY_SERVER,
      topic: "",
      priority: 3,
      token: "",
      clearToken: false,
      botToken: "",
      chatId: "",
      rules: [emptyRule()],
    };
  }
  const c = d.config ?? {};
  return {
    name: d.name,
    type: d.type,
    url: str(c.url),
    server: str(c.server) || DEFAULT_NTFY_SERVER,
    topic: str(c.topic),
    priority: typeof c.priority === "number" ? c.priority : Number(c.priority) || 3,
    token: str(c.token),
    clearToken: false,
    botToken: str(c.botToken),
    chatId: str(c.chatId),
    rules: (d.rules ?? []).map(ruleToDraft),
  };
}

/** Fields the server withheld (secrets). Blank on save keeps the stored value. */
export function hiddenFields(d: Destination | null, type: DestinationType): Set<ConfigField> {
  const out = new Set<ConfigField>();
  if (!d || d.type !== type) return out;
  const c = d.config ?? {};
  const candidates: Record<DestinationType, ConfigField[]> = {
    webhook: ["url"],
    ntfy: c.hasToken ? ["token"] : [],
    telegram: ["botToken"],
  };
  for (const f of candidates[type]) {
    if (!(f in c) || c[f] === null || c[f] === "") out.add(f);
  }
  return out;
}

export function familyOf(ids: string[], networks: Network[]): string | null {
  for (const id of ids) {
    const n = networks.find((x) => x.id === id);
    if (n) return n.family;
  }
  return null;
}

export type Errors = Record<string, string>;

function isHttpUrl(v: string) {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function validate(draft: Draft, hidden: Set<ConfigField>, networks: Network[]): Errors {
  const e: Errors = {};
  const name = draft.name.trim();
  if (!name) e.name = "Give this destination a name.";

  const need = (f: ConfigField, msg: string) => {
    if (!draft[f].trim() && !hidden.has(f)) e[f] = msg;
  };
  if (draft.type === "webhook") {
    need("url", "Enter the URL to POST alerts to.");
    if (draft.url.trim() && !isHttpUrl(draft.url.trim())) e.url = "Use a full http:// or https:// URL.";
  } else if (draft.type === "ntfy") {
    if (!draft.server.trim()) e.server = "Enter the ntfy server URL.";
    else if (!isHttpUrl(draft.server.trim())) e.server = "Use a full https:// URL.";
    need("topic", "Enter a topic.");
    if (draft.topic.trim() && !/^[-_A-Za-z0-9]{1,64}$/.test(draft.topic.trim()))
      e.topic = "Topics use letters, numbers, - and _ (up to 64).";
  } else if (draft.type === "telegram") {
    need("botToken", "Enter the bot token from @BotFather.");
    if (draft.botToken.trim() && !/^\d+:[\w-]{20,}$/.test(draft.botToken.trim()))
      e.botToken = "Bot tokens look like 123456789:AA…";
    need("chatId", "Enter the chat ID.");
    if (draft.chatId.trim() && !/^(-?\d+|@[A-Za-z0-9_]{4,})$/.test(draft.chatId.trim()))
      e.chatId = "Use a numeric chat ID or an @channel name.";
  }

  draft.rules.forEach((r) => {
    const k = (f: string) => `rule.${r.key}.${f}`;
    const fam = familyOf(r.networks, networks);
    if (!r.address.trim()) e[k("address")] = "Enter a wallet address.";
    else {
      const hint = addressHint(r.address, fam);
      if (hint) e[k("address")] = hint;
    }
    if (r.networks.length === 0) e[k("networks")] = "Pick at least one network.";
    else if (new Set(r.networks.map((id) => networks.find((n) => n.id === id)?.family)).size > 1)
      e[k("networks")] = "Networks in one rule must share a chain family.";
    if (r.assetMode !== "all") {
      if (r.assetKind === "contract" && !r.contract.trim()) e[k("contract")] = "Enter the token contract address.";
      if (r.assetKind === "contract" && r.contract.trim()) {
        const hint = addressHint(r.contract, fam);
        if (hint) e[k("contract")] = hint.replace("addresses", "contracts");
      }
      if (r.assetKind === "catalog") {
        if (familyOf(r.networks, networks) === "bitcoin") e[k("token")] = "Bitcoin networks don't have tokens.";
        else if (!r.token) e[k("token")] = "Search for a token and pick a match.";
        else {
          const missing = uncoveredNetworks(r.token, r.networks).map((id) => networks.find((n) => n.id === id)?.name ?? id);
          if (missing.length) e[k("token")] = `No ${r.token.symbol} contract matched on ${missing.join(", ")}. Search again.`;
          else {
            const bad = r.networks.find((id) => addressHint(r.token!.contracts[id], fam));
            if (bad) e[k("token")] = `The catalog returned an invalid contract for ${networks.find((n) => n.id === bad)?.name ?? bad}.`;
          }
        }
      }
      if (r.assetKind === "usdt") {
        const missing = r.networks
          .map((id) => networks.find((n) => n.id === id))
          .filter((n) => n && !n.usdt)
          .map((n) => n!.name);
        if (missing.length) e[k("asset")] = `No verified USDT on ${missing.join(", ")}.`;
      }
    }
  });
  return e;
}

export function toPayload(draft: Draft): DestinationInput {
  const config: Record<string, unknown> = {};
  const put = (k: string, v: string) => {
    if (v.trim()) config[k] = v.trim();
  };
  if (draft.type === "webhook") put("url", draft.url);
  if (draft.type === "ntfy") {
    put("server", draft.server);
    put("topic", draft.topic);
    config.priority = draft.priority;
    if (draft.clearToken) config.token = null;
    else put("token", draft.token);
  }
  if (draft.type === "telegram") {
    put("botToken", draft.botToken);
    put("chatId", draft.chatId);
  }
  return {
    name: draft.name.trim(),
    type: draft.type,
    config,
    rules: draft.rules.map((r): Rule => {
      const rule: Rule = {
        address: r.address.trim(),
        networks: r.networks,
        direction: r.direction,
        assetMode: r.assetMode,
        asset: r.assetMode === "all" ? "native" : r.assetKind === "contract" ? r.contract.trim() : r.assetKind,
      };
      if (rule.asset === "catalog" && r.token) {
        // Only send the exact contracts for this rule's networks.
        const contracts: Record<string, string> = {};
        for (const id of r.networks) contracts[id] = r.token.contracts[id];
        rule.token = { id: r.token.id, symbol: r.token.symbol, name: r.token.name, contracts };
      }
      return rule;
    }),
  };
}
