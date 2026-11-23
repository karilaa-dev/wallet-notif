import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { page, decode } from "../server/providers.js";
import { TokenCatalog } from "../server/catalog.js";
import { validate, matches } from "../server/config.js";
import { byId } from "../server/networks.js";

const eth = byId.get("ethereum"),
  base = byId.get("base"),
  wallet = "0x" + "1".repeat(40),
  peer = "0x" + "2".repeat(40);
const config = {
  name: "Inbox",
  type: "ntfy",
  config: { topic: "topic" },
  rules: [],
};
test("provider imports run once, secrets stay private and cannot follow a changed endpoint", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "wallet-sources-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "wallet.sqlite");
  let store = new Store(path, {
    BLOCKSCOUT_API_KEY: "old-secret",
    TON_API_URL: "https://private.example/path",
    TON_API_KEY: "private-secret",
  });
  const ton = byId.get("ton");
  const edit = (input) => store.atomic(() => store.sources.save(ton, input));
  assert.equal(store.sources.get(eth.id).provider, "pro");
  assert.equal(store.sources.get(ton.id).provider, "custom");
  assert.ok(!JSON.stringify(store.state()).includes("private"));
  edit({ provider: "custom" });
  assert.equal(store.sources.get("ton").apiKey, "private-secret");
  edit({ provider: "custom", url: "https://next.example" });
  assert.equal(store.sources.get("ton").apiKey, "");
  edit({ provider: "toncenter", apiKey: "new-key" });
  edit({ provider: "toncenter", apiKey: null });
  store.atomic(() =>
    store.sources.save(eth, {
      provider: "etherscan",
      apiKey: "updated-secret",
    }),
  );
  store.db.close();
  store = new Store(path, { BLOCKSCOUT_API_KEY: "obsolete-key" });
  t.after(() => store.db.close());
  assert.equal(store.sources.get(eth.id).apiKey, "updated-secret");
  assert.ok(!JSON.stringify(store.state()).includes("updated-secret"));
  assert.throws(() => edit({ provider: "etherscan" }), /supported/);
});

test("explorer pages pin a boundary block and keep distinct identical token transfers across source switches", async (t) => {
  const raw = {
    from: peer,
    to: wallet,
    timeStamp: "100",
    blockNumber: "500",
    hash: "tx",
    contractAddress: eth.usdt,
    value: "50",
    tokenDecimal: "6",
    tokenSymbol: "USDT",
  };
  const source = { provider: "etherscan", apiKey: "test" };
  const first = await page(
    eth,
    wallet,
    "token-transfers",
    null,
    0,
    async (url) => {
      assert.equal(url.searchParams.get("chainid"), "1");
      assert.equal(url.searchParams.get("action"), "tokentx");
      return {
        status: "1",
        result: [...Array(98).fill({ ...raw, blockNumber: "501" }), raw, raw],
      };
    },
    source,
  );
  assert.deepEqual(first.next, { endblock: "500", skip: 2 });
  const second = await page(
    eth,
    wallet,
    "token-transfers",
    first.next,
    0,
    async (url) => {
      assert.equal(url.searchParams.get("endblock"), "500");
      return { status: "1", result: [raw, raw, { ...raw, hash: "older" }] };
    },
    source,
  );
  assert.deepEqual(
    second.rows.map((r) => r.transaction_hash),
    ["older"],
  );
  const store = new Store(":memory:", {});
  t.after(() => store.db.close());
  store.save(
    "a",
    validate({
      ...config,
      rules: [{ address: wallet, networks: ["ethereum"] }],
    }),
    0,
  );
  const watch = store.db
    .prepare("SELECT * FROM watches WHERE feed='token-transfers'")
    .get();
  const row = first.rows.at(-1),
    seen = new Map();
  const normal = [0, 1].flatMap((i) =>
    decode(eth, wallet, watch.feed, {
      ...row,
      accountToken: false,
      log_index: i,
    }),
  );
  const alternate = [0, 1].flatMap(() =>
    decode(eth, wallet, watch.feed, row, seen),
  );
  for (const events of [normal, alternate])
    store.commitScan(watch, { events, watermark: 100000 }, 1000);
  assert.equal(store.state().deliveries.length, 2);
});

test("TON Center and TRONSCAN use confirmed transfer schemas and native pagination", async () => {
  const ton = byId.get("ton"),
    raw = "0:" + "a".repeat(64),
    tx = "ab".repeat(32);
  const data = {
    actions: [
      {
        type: "jetton_transfer",
        trace_id: Buffer.from(tx, "hex").toString("base64"),
        action_id: "act",
        finality: "finalized",
        success: true,
        start_utime: 100,
        details: {
          asset: ton.usdt,
          sender: raw,
          receiver: ton.usdt,
          amount: "1000000",
        },
      },
    ],
    metadata: {
      [ton.usdt]: {
        token_info: [
          { type: "jetton_masters", symbol: "USDT", extra: { decimals: "6" } },
        ],
      },
    },
    next_cursor: "opaque",
  };
  const result = await page(
    ton,
    ton.usdt,
    "events",
    "prev",
    0,
    async (u, h) => {
      assert.equal(u.searchParams.get("cursor"), "prev");
      assert.equal(h["X-API-Key"], "key");
      return data;
    },
    { provider: "toncenter", apiKey: "key" },
  );
  const [event] = decode(ton, ton.usdt, "events", result.rows[0]);
  assert.equal(event.transaction, tx);
  assert.equal(event.amount, "1");
  assert.equal(result.next, "opaque");
  assert.equal(
    decode(ton, ton.usdt, "events", { ...result.rows[0], in_progress: true })
      .length,
    0,
  );
  const tr = byId.get("tron");
  const row = {
    transaction_id: "tx",
    block_ts: 1000,
    from_address: "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR",
    to_address: tr.usdt,
    contract_address: tr.usdt,
    quant: "10",
    event_type: "Transfer",
    confirmed: true,
    contractRet: "SUCCESS",
    tokenInfo: { tokenType: "trc20", tokenDecimal: 6, tokenAbbr: "USDT" },
  };
  const p = await page(
    tr,
    tr.usdt,
    "trc20",
    null,
    0,
    async (u) => {
      assert.equal(u.searchParams.get("relatedAddress"), tr.usdt);
      return { token_transfers: [row, { ...row, confirmed: false }] };
    },
    { provider: "tronscan" },
  );
  assert.deepEqual(
    p.rows
      .flatMap((r) => decode(tr, tr.usdt, "trc20", r))
      .map((e) => e.rawAmount),
    ["10"],
  );
});

test("catalog matches coin IDs across networks, pins saved contracts and survives an upstream outage", async (t) => {
  const store = new Store(":memory:", {});
  t.after(() => store.db.close());
  const data = [
    {
      id: "usd-coin",
      symbol: "usdc",
      name: "USD Coin",
      platforms: { ethereum: wallet, base: peer },
    },
    {
      id: "lookalike",
      symbol: "usdc",
      name: "Other",
      platforms: { ethereum: peer },
    },
  ];
  let calls = 0;
  const catalog = new TokenCatalog(store.db, async () => {
    calls++;
    return Response.json(data);
  });
  const [{ tokens }] = await Promise.all([
    catalog.search(["ethereum", "base"], "USDC"),
    catalog.search(["ethereum"], "usdc"),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(
    tokens.map((t) => t.id),
    ["usd-coin"],
  );
  const rules = validate({
    ...config,
    rules: [
      {
        networks: ["ethereum", "base"],
        address: wallet,
        assetMode: "include",
        asset: "catalog",
        token: tokens[0],
      },
    ],
  }).rules;
  await catalog.resolveRules(rules);
  const isMatch = (network, asset) =>
    matches(rules[0], { network, asset, wallet, direction: "received" });
  assert.ok(isMatch(eth.id, wallet));
  assert.ok(isMatch(base.id, peer));
  assert.ok(!isMatch(base.id, wallet));
  const forged = structuredClone(rules);
  forged[0].token.contracts.base = wallet;
  await assert.rejects(catalog.resolveRules(forged), /listing changed/);
  store.db.prepare("UPDATE token_catalog SET fetched=0").run();
  const offline = new TokenCatalog(store.db, async () => {
    throw Error("offline");
  });
  assert.equal((await offline.search(["base"], "usdc")).stale, true);
  await offline.resolveRules(structuredClone(rules), { rules });
});
