import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { normalize } from "./networks.js";
import { defaultSource } from "./sources.js";
import { toncenterPage, tronscanPage } from "./chain-explorers.js";
import { explorerPage } from "./explorers.js";

export const feeds = {
  evm: ["transactions", "internal-transactions", "token-transfers"],
  ton: ["events"],
  tron: ["transactions", "internal-transactions", "trc20"],
  bitcoin: ["transactions"],
};

async function readJson(url, headers, publicEvm) {
  let res;
  try {
    res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
  } catch {
    throw Error("Provider connection failed or timed out.");
  }
  if (!res.ok) {
    await res.body?.cancel();
    if (publicEvm && [401, 402, 403, 429].includes(res.status)) {
      throw Error(
        "Public explorer returned HTTP " +
          res.status +
          ". Choose an authenticated provider in Sources.",
      );
    }
    throw Error(
      "Provider returned HTTP " +
        res.status +
        ". Check endpoint, API key and rate limits.",
    );
  }
  // Preserve precision for TON int64 values, even when the API emits JSON numbers.
  return JSON.parse(await res.text(), (_, value, context) =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    !Number.isSafeInteger(value)
      ? context.source
      : value,
  );
}

function evmCursor(params) {
  const entries = Object.entries(params ?? {}).filter(
    ([, value]) => value != null,
  );
  return entries.length ? Object.fromEntries(entries) : null;
}

export async function page(
  net,
  wallet,
  feed,
  cursor,
  since,
  read = readJson,
  source = defaultSource(net),
) {
  if (source.provider === "toncenter")
    return toncenterPage(wallet, cursor, since, source, read);
  if (source.provider === "tronscan")
    return tronscanPage(wallet, feed, cursor, since, source, read);
  if (["etherscan", "routescan"].includes(source.provider))
    return explorerPage(net, wallet, feed, cursor, source, read);
  const pro = source.provider === "pro";
  let base = "https://" + net.host;
  if (source.provider === "custom") base = source.url.replace(/\/+$/, "");
  if (pro) base = "https://api.blockscout.com/" + net.chainId;
  if (source.provider === "mempool") base = "https://mempool.space/api";
  let path,
    params = {},
    headers = {};
  const address = encodeURIComponent(wallet);
  switch (net.family) {
    case "evm":
      path = "/api/v2/addresses/" + address + "/" + feed;
      params = { ...evmCursor(cursor) };
      if (feed === "token-transfers") params.type = "ERC-20";
      if (source.apiKey) params.apikey = source.apiKey;
      break;
    case "ton":
      path = "/v2/accounts/" + address + "/events";
      params = { limit: 100, subject_only: true };
      if (cursor) params.before_lt = cursor;
      if (source.apiKey) headers.Authorization = "Bearer " + source.apiKey;
      break;
    case "tron":
      path =
        "/v1/accounts/" +
        address +
        (feed === "trc20" ? "/transactions/trc20" : "/" + feed);
      params = {
        limit: 200,
        only_confirmed: true,
        order_by: "block_timestamp,desc",
        min_timestamp: since,
      };
      if (cursor) params.fingerprint = cursor;
      if (source.apiKey) headers["TRON-PRO-API-KEY"] = source.apiKey;
      break;
    case "bitcoin":
      path =
        "/address/" +
        address +
        "/txs/chain" +
        (cursor ? "/" + encodeURIComponent(cursor) : "");
      break;
  }
  const url = new URL(base + path);
  url.search = new URLSearchParams(params);
  const data = await read(url, headers, source.provider === "blockscout");
  let rows, next;
  switch (net.family) {
    case "evm":
      rows = data.items;
      next = evmCursor(data.next_page_params);
      break;
    case "ton":
      rows = data.events;
      next = data.next_from;
      break;
    case "tron":
      rows = data.data;
      next = data.meta?.fingerprint;
      break;
    case "bitcoin":
      rows = data;
      next = rows.length === 25 && rows.at(-1).txid;
      break;
  }
  if (!Array.isArray(rows) || data.success === false)
    throw Error("Unexpected provider response.");
  return { rows, next };
}

function units(raw, decimals) {
  if (decimals == null) return raw + " base units";
  const d = Number(decimals);
  if (!Number.isInteger(d) || d < 0 || d > 255) return raw + " base units";
  if (!d) return raw;
  const s = raw.padStart(d + 1, "0");
  const fraction = s.slice(-d).replace(/0+$/, "");
  return s.slice(0, -d) + (fraction ? "." + fraction : "");
}
function tronMemo(hex) {
  if (typeof hex !== "string" || !/^(?:[\da-f]{2})+$/i.test(hex)) return;
  const bytes = Buffer.from(hex, "hex");
  if (!isUtf8(bytes)) return;
  const text = bytes.toString("utf8");
  if (!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(text)) return text;
}

export function rowTime(family, row) {
  const value =
    family === "evm"
      ? Date.parse(row.timestamp)
      : family === "ton"
        ? row.timestamp * 1000
        : family === "bitcoin"
          ? row.status.block_time * 1000
          : row.block_timestamp;
  if (!Number.isSafeInteger(value))
    throw Error("Provider returned an invalid block timestamp.");
  return value;
}

export function decode(net, wallet, feed, row, occurrences = new Map()) {
  const events = [];
  function transfer(
    tx,
    part,
    from,
    to,
    value,
    decimals,
    { asset = "native", symbol = net.symbol, comment } = {},
  ) {
    const sender = from ? normalize(net.family, from) : null;
    const receiver = to ? normalize(net.family, to) : null;
    if (sender !== wallet && receiver !== wallet) return;
    const raw = String(value);
    if (!/^\d+$/.test(raw) || !tx || part == null)
      throw Error("Incomplete transfer data.");
    if (BigInt(raw) === 0n) return;
    const direction = receiver === wallet ? "received" : "sent";
    const time = rowTime(net.family, row);
    events.push({
      network: net.id,
      wallet,
      transaction: tx,
      id: tx + ":" + part,
      direction,
      ...(direction === "received" && typeof comment === "string" && comment.trim()
        ? { comment }
        : {}),
      from: sender,
      to: receiver,
      asset,
      symbol: String(symbol || "token")
        .replace(/[\p{C}]/gu, "")
        .slice(0, 40),
      rawAmount: raw,
      decimals: decimals == null ? null : Number(decimals),
      amount: units(raw, decimals),
      timestamp: new Date(time).toISOString(),
    });
  }
  if (net.family === "bitcoin") {
    if (!row.status.confirmed) return events;
    const sum = (outputs) =>
      outputs.reduce(
        (v, o) =>
          o?.scriptpubkey_address === wallet ? v + BigInt(o.value) : v,
        0n,
      );
    const delta = sum(row.vout) - sum(row.vin.map((i) => i.prevout));
    transfer(
      row.txid,
      "net",
      delta < 0n ? wallet : null,
      delta > 0n ? wallet : null,
      delta < 0n ? -delta : delta,
      8,
    );
  } else if (net.family === "evm") {
    const from = row.from?.hash,
      to = row.to?.hash ?? row.created_contract?.hash;
    if (feed === "transactions" && row.status === "ok")
      transfer(row.hash, "native", from, to, row.value, 18);
    if (
      feed === "internal-transactions" &&
      row.success &&
      !row.error &&
      (row.accountTrace ? row.index != null : row.index > 0) &&
      !["delegatecall", "staticcall", "callcode"].includes(row.type)
    )
      transfer(
        row.transaction_hash,
        "trace:" + row.index,
        from,
        to,
        row.value,
        18,
      );
    if (feed === "token-transfers" && row.token?.type === "ERC-20") {
      let position = row.log_index;
      if (position == null) {
        if (!row.accountToken) throw Error("Missing token transfer log index.");
        const signature = createHash("sha256")
          .update(
            JSON.stringify([
              row.transaction_hash,
              from,
              to,
              row.token.address_hash,
              row.total.value,
            ]),
          )
          .digest("hex");
        const index = occurrences.get(signature) ?? 0;
        occurrences.set(signature, index + 1);
        position = signature + ":" + index;
      }
      transfer(
        row.transaction_hash,
        "log:" + position,
        from,
        to,
        row.total.value,
        row.total.decimals ?? row.token.decimals,
        {
          asset: normalize("evm", row.token.address_hash ?? row.token.address),
          symbol: row.token.symbol,
        },
      );
    }
  } else if (net.family === "ton") {
    if (row.in_progress) return events;
    row.actions.forEach((a, i) => {
      if (a.status !== "ok") return;
      const t = a[a.type];
      if (a.type === "TonTransfer")
        transfer(
          row.event_id,
          a.actionId ?? i,
          t.sender.address,
          t.recipient.address,
          t.amount,
          9,
          { comment: t.comment },
        );
      if (a.type === "JettonTransfer")
        transfer(
          row.event_id,
          a.actionId ?? i,
          t.sender?.address,
          t.recipient?.address,
          t.amount,
          t.jetton.decimals,
          {
            asset: normalize("ton", t.jetton.address),
            symbol: t.jetton.symbol,
            comment: t.comment,
          },
        );
    });
  } else if (feed === "internal-transactions") {
    const amount = row.data?.call_value?._;
    if (
      !row.data.rejected &&
      amount &&
      ["call", "create", "suicide"].includes(row.data.note)
    )
      transfer(
        row.tx_id,
        row.internal_tx_id,
        row.from_address,
        row.to_address,
        amount,
        6,
      );
  } else if (feed === "trc20") {
    if (row.type !== "Transfer" || row.token_info?.type === "trc721")
      return events;
    const asset = normalize("tron", row.token_info.address);
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          row.transaction_id,
          asset,
          normalize("tron", row.from),
          normalize("tron", row.to),
          String(row.value),
        ]),
      )
      .digest("hex");
    const index = occurrences.get(key) ?? 0;
    occurrences.set(key, index + 1);
    transfer(
      row.transaction_id,
      key + ":" + index,
      row.from,
      row.to,
      row.value,
      row.token_info.decimals,
      { asset, symbol: row.token_info.symbol },
    );
  } else {
    const comment = tronMemo(row.raw_data.data);
    row.raw_data.contract.forEach((contract, i) => {
      if ((row.ret?.[i] ?? row.ret?.[0])?.contractRet !== "SUCCESS") return;
      const t = contract.parameter.value;
      if (contract.type === "TransferContract")
        transfer(row.txID, i, t.owner_address, t.to_address, t.amount, 6, { comment });
      if (contract.type === "TriggerSmartContract" && t.call_value)
        transfer(
          row.txID,
          i,
          t.owner_address,
          t.contract_address,
          t.call_value,
          6,
          { comment },
        );
    });
  }
  return events;
}

// Anchor to indexed data rather than wall time. Keep a window for late-indexed rows.
export async function scan(watch, net, getPage = page) {
  const { address, feed, started, watermark } = watch;
  const overlap = net.family === "bitcoin" ? 2 * 3600000 : 10 * 60000;
  const since = Math.max(started, watermark - overlap);
  const seen = new Set(),
    occurrences = new Map(),
    events = [];
  let cursor,
    newest = watermark,
    pending = Infinity;
  let emptyPages = 0;
  for (;;) {
    const { rows, next } = await getPage(net, address, feed, cursor, since);
    let older = 0;
    for (const row of rows) {
      if (
        net.family === "evm" &&
        row.timestamp == null &&
        row.block_number == null
      )
        continue;
      const t = rowTime(net.family, row);
      if (t < since) {
        older++;
        continue;
      }
      newest = Math.max(newest, t);
      if (row.in_progress) pending = Math.min(pending, t);
      events.push(...decode(net, address, feed, row, occurrences));
    }
    if (!next || (rows.length > 0 && older === rows.length)) break;
    emptyPages = rows.length ? 0 : emptyPages + 1;
    if (emptyPages > 100)
      throw Error("Provider repeatedly returned empty continuation pages.");
    const key = JSON.stringify(next);
    if (seen.has(key)) throw Error("Provider repeated its pagination cursor.");
    seen.add(key);
    cursor = next;
  }
  return { events: events.reverse(), watermark: Math.min(newest, pending) };
}
