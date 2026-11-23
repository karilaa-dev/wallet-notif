import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { startWorkers } from "../server/worker.js";

async function listen(t, handler) {
  const server = createServer(handler).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return "http://127.0.0.1:" + server.address().port;
}

test("sign in, create a BTC watch, deliver through HTTP, edit a hidden URL and sign out", async (t) => {
  const store = new Store(":memory:");
  const wallet = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
    messages = [];
  const provider = await listen(t, (req, res) => {
    assert.equal(req.url, "/address/" + wallet + "/txs/chain");
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify([
        {
          txid: "bitcoin-tx",
          status: { confirmed: true, block_time: Math.ceil(Date.now() / 1000) },
          vin: [{ prevout: null }],
          vout: [{ scriptpubkey_address: wallet, value: 123456 }],
        },
      ]),
    );
  });
  const sink = await listen(t, async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    messages.push({
      key: req.headers["idempotency-key"],
      body: JSON.parse(body),
    });
    res.writeHead(204).end();
  });
  const url = await listen(t, createApp(store, "test-password"));
  let cookie = "";
  function api(path, method = "GET", data, extra = {}) {
    return fetch(url + "/api/" + path, {
      method,
      headers: { cookie, "Content-Type": "application/json", ...extra },
      body: JSON.stringify(data),
    });
  }
  assert.equal((await api("state")).status, 401);
  assert.equal((await api("login", "POST", { password: "bad" })).status, 401);
  const login = await api("login", "POST", { password: "test-password" });
  assert.equal(login.status, 200);
  cookie = login.headers.get("Set-Cookie").split(";")[0];
  assert.equal(
    (await api("logout", "POST", undefined, { Origin: "https://other.test" }))
      .status,
    403,
  );
  assert.equal(
    (await api("sources/bitcoin", "PUT", { provider: "custom", url: provider }))
      .status,
    200,
  );
  const config = {
    name: "BTC inbox",
    type: "webhook",
    config: { url: sink + "/secret" },
    rules: [{ address: wallet, networks: ["bitcoin"] }],
  };
  const create = await api("destinations", "POST", config);
  assert.equal(create.status, 201);
  const { id } = await create.json();
  const path = "destinations/" + id;
  assert.equal((await api(path + "/test", "POST")).status, 200);
  const state = await (await api("state")).json();
  assert.equal(state.destinations[0].config.url, undefined);
  assert.equal(state.destinations[0].rules[0].direction, "received");
  assert.equal(state.monitors.length, 1);
  assert.equal(
    (await api(path, "PUT", { ...config, name: "Edited", config: {} })).status,
    200,
  );
  const stop = startWorkers(store, 60000);
  t.after(stop);
  for (let i = 0; i < 100 && messages.length < 2; i++) await delay(30);
  stop();
  assert.deepEqual(
    messages.map((m) => m.body.type),
    ["test", "transfer"],
  );
  assert.equal(messages[1].body.amount, "0.00123456");
  assert.equal(messages[1].body.deliveryId, messages[1].key);
  assert.equal(messages[1].body.destination, "Edited");
  assert.equal((await api(path, "DELETE")).status, 204);
  assert.equal((await (await api("state")).json()).destinations.length, 0);
  assert.equal((await api("logout", "POST")).status, 200);
  assert.equal((await api("state")).status, 401);
  store.db.close();
});
