import { randomUUID } from "node:crypto";
import { transferNotification } from "./notification.js";

const MAX_RETRY_MS = 3600000;

export async function deliver(dest, row, send = fetch) {
  const c = dest.config,
    event = JSON.parse(row.payload);
  const transfer = event.type === "transfer" ? transferNotification(event) : null;
  const text = transfer?.message ?? "🔔 Test notification for " + dest.name;
  const link = transfer?.transactionUrl;
  let url, body;
  const headers = { "Content-Type": "application/json" };
  switch (dest.type) {
    case "webhook":
      url = c.url;
      body = { deliveryId: row.id, destination: dest.name, ...event, ...transfer };
      headers["Idempotency-Key"] = row.id;
      break;
    case "ntfy":
      url = c.server;
      body = {
        topic: c.topic,
        priority: c.priority,
        title: dest.name,
        message: text,
      };
      if (link) {
        body.click = link;
        body.actions = [{ action: "view", label: "View transaction", url: link }];
      }
      if (c.token) headers.Authorization = "Bearer " + c.token;
      break;
    case "telegram":
      url = "https://api.telegram.org/bot" + c.botToken + "/sendMessage";
      body = { chat_id: c.chatId, text };
      if (link) {
        body.reply_markup = {
          inline_keyboard: [[{ text: "View transaction", url: link }]],
        };
      }
      break;
  }
  let res;
  try {
    res = await send(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw Error("Destination connection failed or timed out.");
  }
  if (!res.ok) {
    await res.body?.cancel();
    const err = Error("Destination returned HTTP " + res.status + ".");
    const retryAfter = res.headers.get("Retry-After");
    if (retryAfter)
      err.delay = Number.isFinite(Number(retryAfter))
        ? Number(retryAfter) * 1000
        : Date.parse(retryAfter) - Date.now();
    throw err;
  }
  if (dest.type === "telegram") {
    if ((await res.json()).ok !== true)
      throw Error("Telegram rejected the message.");
  } else await res.body?.cancel();
}

export async function sendOne(store, id, send = fetch, isTest = false) {
  const row = store.atomic(() => {
    const now = Date.now();
    // The due time doubles as a lease, allowing crash recovery after a send.
    const q = store.db
      .prepare(`UPDATE deliveries SET attempts=attempts+1,status='sending',due=?
      WHERE id=? AND status IN ('queued','retrying','sending') AND due<=? RETURNING *`);
    return q.get(now + 60000, id, now);
  });
  if (!row) return;
  const dest = store.destination(row.destination);
  if (!dest) return;
  try {
    await deliver(dest, row, send);
    store.db
      .prepare(
        "UPDATE deliveries SET status='sent',error=NULL WHERE id=? AND attempts=?",
      )
      .run(id, row.attempts);
  } catch (e) {
    const error =
      e instanceof SyntaxError ? "Invalid destination response." : e.message;
    const status = isTest || row.attempts >= 12 ? "failed" : "retrying";
    const requestedDelay = Number.isFinite(e.delay) ? e.delay : 0;
    const delay = Math.min(
      MAX_RETRY_MS,
      Math.max(5000 * 2 ** (row.attempts - 1), requestedDelay),
    );
    store.db
      .prepare(
        "UPDATE deliveries SET status=?,due=?,error=? WHERE id=? AND attempts=?",
      )
      .run(status, Date.now() + delay, error, id, row.attempts);
    if (isTest) throw Error(error);
  }
}
// Start one due notification per available destination. Each slot is released
// independently, so a slow request cannot delay the next dispatch tick.
export function createDispatcher(store, send = fetch) {
  const active = new Set();
  const limit = 4;
  const latestDue = Date.now() + MAX_RETRY_MS;
  store.db
    .prepare("UPDATE deliveries SET due=? WHERE status='retrying' AND due>?")
    .run(latestDue, latestDue);
  return () => {
    const slots = limit - active.size;
    if (!slots) return;
    const excluded = active.size
      ? "AND destination NOT IN (" +
        Array(active.size).fill("?").join(",") +
        ")"
      : "";
    const rows = store.db
      .prepare(
        `
      SELECT id, destination FROM (
        SELECT id,destination,due,created,rowid AS seq,
          row_number() OVER (PARTITION BY destination ORDER BY due,created,rowid) AS position
        FROM deliveries WHERE status IN ('queued','sending','retrying') AND due<=? ${excluded}
      ) WHERE position=1 ORDER BY due,created,seq LIMIT ?`,
      )
      .all(Date.now(), ...active, slots);
    for (const row of rows) {
      active.add(row.destination);
      void sendOne(store, row.id, send)
        .catch((e) => console.error("Delivery worker failed:", e.name))
        .finally(() => active.delete(row.destination));
    }
  };
}

export async function testDestination(store, id, send) {
  const key = randomUUID();
  const rowId = store.enqueue(
    id,
    key,
    { type: "test" },
    "Test notification",
    Date.now(),
  );
  await sendOne(store, rowId, send, true);
}
