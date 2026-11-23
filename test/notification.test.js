import assert from "node:assert/strict";
import test from "node:test";
import { Address } from "@ton/core";
import { deliver } from "../server/delivery.js";
import { networks } from "../server/networks.js";
import { transferNotification } from "../server/notification.js";

const hash = "ab".repeat(32);
const wallet = "0:" + "12".repeat(32);
const ton = {
  type: "transfer", network: "ton", transaction: hash, wallet,
  direction: "received", to: wallet, asset: "native", symbol: "TON", amount: "0.599",
};
const link = "https://tonviewer.com/transaction/" + hash;

test("TON alerts show a compact friendly address and a transaction action across destinations", async () => {
  const event = { ...ton, comment: "Invoice #42 🧾" };
  const friendly = Address.parse(wallet).toString({ bounceable: false });
  const text = "📥 Received 0.599 TON\n👛 Wallet " + friendly.slice(0, 8) + "…" + friendly.slice(-6) + "\n💬 Comment: Invoice #42 🧾";
  for (const type of ["ntfy", "telegram", "webhook"]) {
    const dest = { name: "Inbox", type, config: { topic: "inbox", chatId: "123" } };
    const row = { id: "row", payload: JSON.stringify(event), summary: "old notification format" };
    await deliver(dest, row, async (_, opts) => {
      const body = JSON.parse(opts.body);
      if (type === "ntfy") {
        assert.equal(body.message, text);
        assert.equal(body.click, link);
        assert.deepEqual(body.actions, [{ action: "view", label: "View transaction", url: link }]);
      } else if (type === "telegram") {
        assert.equal(body.text, text);
        assert.deepEqual(body.reply_markup.inline_keyboard, [[{ text: "View transaction", url: link }]]);
      } else {
        assert.deepEqual(body, { deliveryId: "row", destination: "Inbox", ...event, message: text, transactionUrl: link });
      }
      return Response.json({ ok: true });
    });
  }
});

test("transfer copy preserves exact amounts, network and contract identity", () => {
  const event = {
    ...ton, network: "base", wallet: "0x" + "11".repeat(20), asset: "0x" + "22".repeat(20),
    transaction: "0x" + hash, direction: "sent", amount: "9007199254740993.000001", symbol: "USDC",
  };
  const { message, transactionUrl } = transferNotification(event);
  assert.equal(message, "📤 Sent 9007199254740993.000001 USDC on Base\n👛 Wallet 0x111111…111111\nToken contract 0x222222…222222");
  assert.equal(transactionUrl, "https://basescan.org/tx/0x" + hash);
  assert.match(transferNotification({ ...ton, from: wallet }).message, /Self-transfer of/);
  assert.match(transferNotification({ ...ton, network: "bitcoin", symbol: "BTC", direction: "sent" }).message, /Net outflow of/);
});

test("every supported network has an explorer and invalid identifiers never become links", () => {
  for (const net of networks) {
    const transaction = net.family === "evm" ? "0x" + hash : hash;
    const result = transferNotification({ ...ton, network: net.id, transaction });
    assert.ok(result.transactionUrl.startsWith("https://"));
    assert.ok(result.transactionUrl.endsWith(transaction));
  }
  const result = transferNotification({ ...ton, transaction: "unexpected-id" });
  assert.equal(result.transactionUrl, null);
  assert.match(result.message, /Transaction unexpected-id/);
});

test("long Unicode comments fit the push destination and stay complete in webhooks", async () => {
  const event = { ...ton, comment: "🧾".repeat(4200) };
  for (const type of ["ntfy", "telegram", "webhook"]) {
    await deliver({ name: "Inbox", type, config: {} }, { payload: JSON.stringify(event) }, async (_, opts) => {
      const body = JSON.parse(opts.body);
      const text = body.message ?? body.text;
      if (type === "webhook") {
        assert.ok(text.endsWith(event.comment));
        assert.equal(body.comment, event.comment);
      } else {
        assert.ok(text.endsWith("🧾…"));
        assert.ok(type === "ntfy" ? Buffer.byteLength(text) <= 4096 : Array.from(text).length === 4096);
      }
      return Response.json({ ok: true });
    });
  }
});
