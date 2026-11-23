import { byId, normalize } from "./networks.js";

const url = "https://api.coingecko.com/api/v3/coins/list?include_platform=true";
const platforms = {
  ethereum: "ethereum",
  base: "base",
  arbitrum: "arbitrum-one",
  optimism: "optimistic-ethereum",
  polygon: "polygon-pos",
  bsc: "binance-smart-chain",
  avalanche: "avalanche",
  ton: "the-open-network",
  tron: "tron",
};
const ttl = 24 * 3600000;
const unavailable = () =>
  Object.assign(
    Error(
      "CoinGecko is unavailable. Try again shortly or enter a contract address.",
    ),
    { status: 503 },
  );

function normalizeList(rows) {
  if (!Array.isArray(rows)) throw unavailable();
  const tokens = [];
  for (const row of rows) {
    if (
      typeof row?.id !== "string" ||
      typeof row.name !== "string" ||
      typeof row.symbol !== "string"
    )
      continue;
    const contracts = {};
    for (const [network, platform] of Object.entries(platforms)) {
      const address = row.platforms?.[platform];
      if (!address) continue;
      try {
        contracts[network] = normalize(byId.get(network).family, address);
      } catch {
        /* Skip invalid or native identifiers. */
      }
    }
    if (Object.keys(contracts).length)
      tokens.push({
        id: row.id,
        name: row.name,
        symbol: row.symbol.toUpperCase(),
        contracts,
      });
  }
  if (!tokens.length) throw unavailable();
  return tokens;
}
export function tokenNetworks(ids) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.some((id) => !Object.hasOwn(platforms, id))
  )
    throw Error("Select a token-capable network.");
  return [...new Set(ids)];
}
function forNetworks(token, networks) {
  if (!token || networks.some((id) => !token.contracts[id])) return null;
  return {
    ...token,
    contracts: Object.fromEntries(
      networks.map((id) => [id, token.contracts[id]]),
    ),
  };
}

export class TokenCatalog {
  constructor(db, fetcher = fetch) {
    this.db = db;
    this.fetcher = fetcher;
    db.exec(
      "CREATE TABLE IF NOT EXISTS token_catalog(id INTEGER PRIMARY KEY CHECK(id=1), fetched INTEGER, tokens TEXT)",
    );
    const saved = db.prepare("SELECT * FROM token_catalog WHERE id=1").get();
    this.tokens = saved ? JSON.parse(saved.tokens) : [];
    this.validUntil = (saved?.fetched ?? 0) + ttl;
    this.retryAt = 0;
  }
  async refresh() {
    const now = Date.now();
    if (this.validUntil > now && this.tokens.length) return;
    if (this.pending) return this.pending;
    if (this.retryAt > now) {
      if (!this.tokens.length) throw unavailable();
      return;
    }
    this.pending = (async () => {
      try {
        const res = await this.fetcher(url, {
          signal: AbortSignal.timeout(12000),
          redirect: "error",
        });
        if (!res.ok) {
          await res.body?.cancel();
          throw unavailable();
        }
        const tokens = normalizeList(await res.json());
        this.db
          .prepare("INSERT OR REPLACE INTO token_catalog VALUES(1,?,?)")
          .run(now, JSON.stringify(tokens));
        this.tokens = tokens;
        this.validUntil = now + ttl;
      } catch {
        this.retryAt = Date.now() + 60000;
        if (!this.tokens.length) throw unavailable();
      }
    })();
    try {
      await this.pending;
    } finally {
      this.pending = null;
    }
  }
  async search(ids, query) {
    const networks = tokenNetworks(ids);
    const q = query.trim().toLowerCase();
    if (q.length > 160) throw Error("Search text is too long.");
    await this.refresh();
    const matches = [];
    for (const t of this.tokens) {
      if (networks.some((id) => !t.contracts[id])) continue;
      const values = [t.symbol.toLowerCase(), t.name.toLowerCase(), t.id];
      const rank = values.includes(q)
        ? 0
        : values.some((v) => v.startsWith(q))
          ? 1
          : values.some((v) => v.includes(q))
            ? 2
            : 3;
      if (rank < 3) matches.push({ rank, t });
    }
    matches.sort(
      (a, b) =>
        a.rank - b.rank ||
        a.t.name.localeCompare(b.t.name) ||
        a.t.id.localeCompare(b.t.id),
    );
    return {
      tokens: matches.slice(0, 30).map(({ t }) => forNetworks(t, networks)),
      stale: this.validUntil <= Date.now(),
      source: "CoinGecko",
    };
  }
  async resolveRules(rules, previous) {
    for (const rule of rules) {
      if (rule.asset !== "catalog") continue;
      const same = (t) =>
        t?.id === rule.token.id &&
        rule.networks.every(
          (id) => t.contracts[id] === rule.token.contracts[id],
        );
      // Keep saved addresses pinned, including when a listing changes or goes offline.
      let token = previous?.rules.map((r) => r.token).find(same);
      if (!token) {
        await this.refresh();
        token = this.tokens.find((t) => t.id === rule.token.id);
        if (!same(token))
          throw Error(
            "This token listing changed. Search again and select its current contracts.",
          );
      }
      rule.token = forNetworks(token, rule.networks);
    }
  }
}
