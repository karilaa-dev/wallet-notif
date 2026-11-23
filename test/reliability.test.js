import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { page, scan } from "../server/providers.js";
import { Store } from "../server/store.js";
import { createDispatcher, sendOne } from "../server/delivery.js";
import { byId } from "../server/networks.js";

const net = byId.get("ethereum");
const wallet = "0x" + "1".repeat(40),
  peer = "0x" + "2".repeat(40);
const watch = {
  address: wallet,
  network: net.id,
  feed: "transactions",
  started: 0,
  watermark: 0,
};
const row = {
  hash: "tx",
  status: "ok",
  timestamp: new Date(10000).toISOString(),
  from: { hash: peer },
  to: { hash: wallet },
  value: "1",
};
const endpoint = {
  name: "Inbox",
  type: "webhook",
  config: { url: "http://local.test/" },
  rules: [],
};

test("Blockscout follows empty continuation pages and drops null cursor fields", async () => {
  const responses = [
    { items: [row], next_page_params: { block_number: 8, fee: null } },
    { items: [], next_page_params: { block_number: 7, fee: undefined } },
    {
      items: [{ ...row, hash: "old", timestamp: new Date(9000).toISOString() }],
      next_page_params: {},
    },
  ];
  const urls = [];
  const result = await scan(watch, net, (...args) =>
    page(...args, async (url) => {
      urls.push(url);
      return responses.shift();
    }),
  );
  assert.deepEqual(
    urls.map((u) => u.searchParams.get("block_number")),
    [null, "8", "7"],
  );
  assert.ok(urls.every((u) => !u.searchParams.has("fee")));
  assert.deepEqual(
    result.events.map((e) => e.transaction),
    ["old", "tx"],
  );
  assert.equal(result.watermark, 10000);
});

test("a nonprogressing empty continuation fails the scan without committing a partial result", async () => {
  await assert.rejects(
    scan(watch, net, async () => ({ rows: [], next: { block: 1 } })),
    /repeated/,
  );
  let counter = 0;
  await assert.rejects(
    scan(watch, net, async () => ({ rows: [], next: ++counter })),
    /empty continuation/,
  );
});

test("widening, narrowing and re-adding legacy rules retain the start time only of continuously matched activity", () => {
  for (const legacyStart of [1000, { ethereum: 1000 }]) {
    const store = new Store(":memory:");
    try {
      const rule = {
        address: wallet,
        networks: [net.id],
        direction: "received",
        assetMode: "include",
        asset: "usdt",
      };
      store.db
        .prepare("INSERT INTO destinations VALUES (?,?)")
        .run(
          "inbox",
          JSON.stringify({
            ...endpoint,
            rules: [{ ...rule, since: legacyStart }],
          }),
        );
      store.syncWatches(1000);
      const set = (overrides, at) =>
        store.save(
          "inbox",
          { ...endpoint, rules: [{ ...rule, ...overrides }] },
          at,
        );
      set({ assetMode: "all", direction: "both" }, 3000);
      set({ assetMode: "exclude", asset: "native", direction: "both" }, 5000);
      set({ assetMode: "all", direction: "both" }, 7000);
      const w = store.db
        .prepare("SELECT * FROM watches WHERE feed='transactions'")
        .get();
      const ev = (id, at, asset, direction) => ({
        id,
        amount: "1",
        wallet,
        network: net.id,
        symbol: "TOKEN",
        timestamp: new Date(at).toISOString(),
        asset,
        direction,
      });
      const events = [
        ev("original", 2000, net.usdt, "received"),
        ev("early-send", 2000, net.usdt, "sent"),
        ev("early-other", 2000, peer, "received"),
        ev("eligible-send", 4000, net.usdt, "sent"),
        ev("eligible-other", 4000, peer, "received"),
        ev("interrupted", 4000, "native", "received"),
        ev("excluded", 6000, "native", "received"),
        ev("new-native", 8000, "native", "received"),
      ];
      store.commitScan(w, { watermark: 8000, events }, 60000);
      const ids = store.db
        .prepare("SELECT payload FROM deliveries ORDER BY rowid")
        .all()
        .map((r) => JSON.parse(r.payload).id);
      assert.deepEqual(ids, [
        "original",
        "eligible-send",
        "eligible-other",
        "new-native",
      ]);
    } finally {
      store.db.close();
    }
  }
});

test("excessive retry delays, including legacy stranded retries, stay finite and bounded", async () => {
  const store = new Store(":memory:");
  try {
    store.save("inbox", endpoint);
    for (const header of [
      "1e306",
      "999999999999",
      "Fri, 01 Jan 2100 00:00:00 GMT",
      "invalid",
    ]) {
      const id = store.enqueue("inbox", header, { type: "test" }, "test", 0);
      await sendOne(
        store,
        id,
        async () =>
          new Response(null, {
            status: 429,
            headers: { "Retry-After": header },
          }),
      );
      const r = store.db
        .prepare("SELECT due,status FROM deliveries WHERE id=?")
        .get(id);
      assert.equal(r.status, "retrying");
      assert.ok(
        Number.isFinite(r.due) &&
          r.due > Date.now() &&
          r.due <= Date.now() + 3600000,
      );
    }
    store.db.prepare("UPDATE deliveries SET due=?").run(Infinity);
    createDispatcher(store);
    assert.ok(
      store.db.prepare("SELECT MAX(due) AS due FROM deliveries").get().due <=
        Date.now() + 3600000,
    );
  } finally {
    store.db.close();
  }
});

test("a slow destination occupies one delivery slot while healthy destinations continue draining", async () => {
  const store = new Store(":memory:");
  let release;
  const slow = new Promise((resolve) => {
    release = resolve;
  });
  let slowCalls = 0,
    healthyCalls = 0;
  try {
    for (const id of ["slow", "healthy"]) {
      store.save(id, { ...endpoint, name: id });
      for (let i = 0; i < 9; i++)
        store.enqueue(id, String(i), { type: "test" }, "test", 0);
    }
    const dispatch = createDispatcher(store, async (_url, opts) => {
      if (JSON.parse(opts.body).destination === "slow") {
        slowCalls++;
        await slow;
      } else healthyCalls++;
      return new Response(null, { status: 204 });
    });
    for (let i = 0; i < 4; i++) {
      dispatch();
      await nextTurn();
    }
    assert.equal(slowCalls, 1);
    assert.equal(healthyCalls, 4);
  } finally {
    release();
    await nextTurn();
    store.db.close();
  }
});
