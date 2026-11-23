import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.js";
import { byId, normalize } from "../server/networks.js";
import { decode, page, scan } from "../server/providers.js";
import { validate } from "../server/config.js";
import { sendOne, deliver } from "../server/delivery.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const eth = byId.get("ethereum"),
  wallet = "0x" + "1".repeat(40),
  peer = "0x" + "2".repeat(40);
const start = 1600000000000;
function destination(mode, direction = "received") {
  return validate({
    name: "Inbox",
    type: "webhook",
    config: { url: "https://example.test/hook" },
    rules: [
      {
        address: wallet,
        networks: ["ethereum", "base"],
        direction,
        assetMode: mode,
        asset: mode === "all" ? null : "usdt",
      },
    ],
  });
}
const event = {
  network: "ethereum",
  wallet,
  direction: "received",
  asset: eth.usdt,
  id: "tx:1",
  timestamp: new Date(start + 2000).toISOString(),
  amount: "2",
  symbol: "USDT",
};

test("USDT and everything else remain disjoint across overlap, restart and overlapping rules", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "wallet-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "test.sqlite");
  let store = new Store(file);
  const a = destination("include");
  store.save("a", { ...a, rules: [...a.rules, ...a.rules] }, start);
  store.save("b", destination("exclude"), start);
  store.save("c", destination("all", "sent"), start);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM watches").get().n, 6);
  const w = store.db
    .prepare("SELECT * FROM watches WHERE network='ethereum'")
    .get();
  const result = {
    watermark: start + 3000,
    events: [
      event,
      { ...event, id: "tx:2", asset: peer },
      { ...event, id: "tx:3", direction: "sent" },
    ],
  };
  store.commitScan(w, result, 1000);
  store.db.close();
  store = new Store(file);
  t.after(() => store.db.close());
  store.commitScan(w, result, 1000);
  const rows = store.db
    .prepare("SELECT * FROM deliveries ORDER BY destination")
    .all();
  assert.deepEqual(
    rows.map((r) => [r.destination, JSON.parse(r.payload).id]),
    [
      ["a", "tx:1"],
      ["b", "tx:2"],
      ["c", "tx:3"],
    ],
  );
  await sendOne(
    store,
    rows[0].id,
    async () => new Response(null, { status: 503 }),
  );
  assert.equal(
    store.state().deliveries.find((d) => d.id === rows[0].id).status,
    "retrying",
  );
  store.db.prepare("UPDATE deliveries SET due=0 WHERE id=?").run(rows[0].id);
  const seen = [];
  const send = async (url, options) => {
    seen.push(options.headers["Idempotency-Key"]);
    return new Response(null, { status: 204 });
  };
  await Promise.all([
    sendOne(store, rows[0].id, send),
    sendOne(store, rows[0].id, send),
  ]);
  assert.deepEqual(seen, [rows[0].id]);
  store.remove("a");
  assert.equal(store.state().monitors.length, 2);
});

test("EVM keeps log positions and exact amounts, drops reverted transactions", () => {
  const row = {
    hash: "tx",
    transaction_hash: "tx",
    timestamp: new Date(start).toISOString(),
    from: { hash: peer },
    to: { hash: wallet },
    value: "9007199254740993123456",
  };
  assert.equal(
    decode(eth, wallet, "transactions", { ...row, status: "error" }).length,
    0,
  );
  assert.equal(
    decode(eth, wallet, "transactions", { ...row, status: "ok" })[0].amount,
    "9007.199254740993123456",
  );
  const token = {
    ...row,
    token: { type: "ERC-20", address_hash: eth.usdt, symbol: "USDT" },
    total: { value: "2500001", decimals: "6" },
    log_index: 4,
  };
  assert.equal(decode(eth, wallet, "token-transfers", token)[0].id, "tx:log:4");
  assert.equal(
    decode(eth, wallet, "token-transfers", token)[0].amount,
    "2.500001",
  );
  assert.equal(
    decode(eth, wallet, "internal-transactions", {
      ...row,
      index: 2,
      success: true,
      type: "call",
    })[0].id,
    "tx:trace:2",
  );
});

test("TON friendly addresses, in-progress events and mixed action outcomes", () => {
  const net = byId.get("ton"),
    address = net.usdt;
  assert.equal(
    normalize("ton", "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs"),
    address,
  );
  const action = {
    type: "JettonTransfer",
    status: "ok",
    JettonTransfer: {
      recipient: { address },
      amount: "4000000",
      comment: "Transfer #1",
      jetton: { address, decimals: 6, symbol: "USDT" },
    },
  };
  const row = {
    event_id: "hash",
    timestamp: start / 1000,
    actions: [{ ...action, status: "failed" }, action],
  };
  assert.equal(
    decode(net, address, "events", { ...row, in_progress: true }).length,
    0,
  );
  assert.deepEqual(
    decode(net, address, "events", row).map((e) => [
      e.id,
      e.direction,
      e.amount,
    ]),
    [["hash:1", "received", "4"]],
  );
  assert.equal(decode(net, address, "events", row)[0].comment, "Transfer #1");
});

test("TRON ignores approvals, distinguishes identical logs and decodes contract-sent TRX", () => {
  const net = byId.get("tron"),
    address = net.usdt,
    occurrences = new Map();
  const row = {
    transaction_id: "tx",
    from: "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR",
    to: address,
    block_timestamp: start,
    token_info: { address, decimals: 6, symbol: "USDT" },
    value: "123456",
  };
  assert.equal(
    decode(net, address, "trc20", { ...row, type: "Approval" }).length,
    0,
  );
  const first = decode(
    net,
    address,
    "trc20",
    { ...row, type: "Transfer" },
    occurrences,
  )[0];
  const second = decode(
    net,
    address,
    "trc20",
    { ...row, type: "Transfer" },
    occurrences,
  )[0];
  assert.equal(first.amount, "0.123456");
  assert.notEqual(first.id, second.id);
  const data = {
    internal_tx_id: "i",
    tx_id: "tx",
    block_timestamp: start,
    data: { note: "call", rejected: false, call_value: { _: 1111111 } },
    to_address: "41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
    from_address: row.from,
  };
  assert.equal(
    decode(net, address, "internal-transactions", data)[0].amount,
    "1.111111",
  );
});

test("native TRX transfers include incoming text memos and ignore binary data", () => {
  const net = byId.get("tron"), sender = "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR";
  function transfer(wallet, data) {
    return decode(net, wallet, "transactions", {
      txID: "tx", block_timestamp: start, ret: [{ contractRet: "SUCCESS" }],
      raw_data: { data, contract: [{
        type: "TransferContract", parameter: { value: { owner_address: sender, to_address: net.usdt, amount: 1 } },
      }] },
    })[0];
  }
  const memo = Buffer.from("Invoice 🧾").toString("hex");
  assert.equal(transfer(net.usdt, memo).comment, "Invoice 🧾");
  assert.equal(transfer(sender, memo).comment, undefined);
  for (const value of [undefined, "", "invalid", "00", "ff", "20"]) {
    assert.equal(transfer(net.usdt, value).comment, undefined);
  }
});

test("BTC reports net movement once and ignores unconfirmed changes", () => {
  const btc = byId.get("bitcoin"),
    address = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
  const out = (value) => ({ scriptpubkey_address: address, value });
  const row = {
    txid: "tx",
    status: { confirmed: true, block_time: start / 1000 },
    vin: [{ prevout: out(50000) }],
    vout: [out(5000)],
  };
  assert.deepEqual(
    decode(btc, address, "transactions", row).map((e) => [
      e.direction,
      e.rawAmount,
    ]),
    [["sent", "45000"]],
  );
  assert.equal(
    decode(btc, address, "transactions", {
      ...row,
      status: { confirmed: false },
    }).length,
    0,
  );
});

test("pagination reaches older pages and refuses a partial scan on failure", async () => {
  const watch = {
    feed: "transactions",
    address: wallet,
    started: start,
    watermark: start,
  };
  const row = {
    hash: "1",
    timestamp: new Date(start + 1000).toISOString(),
    status: "ok",
    value: "1",
    from: { hash: peer },
    to: { hash: wallet },
  };
  const read = async (_n, _a, _f, c) =>
    c ? { rows: [{ ...row, hash: "2" }] } : { rows: [row], next: { block: 1 } };
  assert.equal((await scan(watch, eth, read)).events.length, 2);
  await assert.rejects(
    scan(watch, eth, async (...args) => {
      if (args[3]) throw Error("429");
      return read(...args);
    }),
    /429/,
  );
  const net = byId.get("tron");
  await page(net, net.usdt, "trc20", "cursor", start, async (u) => {
    assert.equal(u.searchParams.get("min_timestamp"), String(start));
    assert.equal(u.searchParams.get("fingerprint"), "cursor");
    assert.equal(u.searchParams.get("only_confirmed"), "true");
    return { data: [] };
  });
});

test("ntfy and Telegram format native provider requests", async () => {
  const cases = [
    [
      {
        type: "ntfy",
        config: {
          server: "https://ntfy.example",
          topic: "ledger",
          token: "secret",
          priority: 4,
        },
      },
      "https://ntfy.example",
      {
        topic: "ledger",
        priority: 4,
        title: "Inbox",
        message: "🔔 Test notification for Inbox",
      },
    ],
    [
      { type: "telegram", config: { botToken: "1:secret", chatId: "123" } },
      "https://api.telegram.org/bot1:secret/sendMessage",
      { chat_id: "123", text: "🔔 Test notification for Inbox" },
    ],
  ];
  for (const [dest, url, body] of cases)
    await deliver(
      { ...dest, name: "Inbox" },
      { id: "key", payload: '{"type":"test"}' },
      async (target, opts) => {
        assert.equal(target, url);
        assert.deepEqual(JSON.parse(opts.body), body);
        if (dest.type === "ntfy")
          assert.equal(opts.headers.Authorization, "Bearer secret");
        return Response.json({ ok: true });
      },
    );
});

test("adding a network preserves activity awaiting indexing on the original network", () => {
  const store = new Store(":memory:");
  try {
    const settings = destination("include");
    const single = {
      ...settings,
      rules: settings.rules.map((rule) => ({
        ...rule,
        networks: ["ethereum"],
      })),
    };
    store.save("inbox", single, start);
    store.save("inbox", settings, start + 3000);
    const watch = store.db
      .prepare("SELECT * FROM watches WHERE network='ethereum'")
      .get();
    store.commitScan(watch, { watermark: start + 2000, events: [event] }, 1000);
    assert.equal(store.state().deliveries.length, 1);
    assert.equal(store.state().destinations[0].rules[0].since, undefined);
  } finally {
    store.db.close();
  }
});

test("changing an ntfy server requires explicitly replacing or clearing its saved token", () => {
  const source = {
    name: "Ops",
    type: "ntfy",
    rules: [],
    config: { server: "https://one.example", topic: "ops", token: "tk_saved" },
  };
  const saved = validate(source);
  const edited = {
    ...source,
    config: { server: "https://two.example", topic: "ops" },
  };
  assert.throws(() => validate(edited, saved), /token/);
  assert.equal(
    validate({ ...edited, config: { ...edited.config, token: null } }, saved)
      .config.token,
    "",
  );
  assert.equal(
    validate(
      { ...source, config: { topic: "ops", server: "https://one.example" } },
      saved,
    ).config.token,
    "tk_saved",
  );
});
