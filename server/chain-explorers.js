export async function toncenterPage(wallet, cursor, since, source, read) {
  const limit = 100;
  const url = new URL("https://toncenter.com/api/v3/actions");
  url.search = new URLSearchParams({
    account: wallet,
    start_utime: Math.floor(since / 1000),
    sort: "desc",
    limit,
  });
  url.searchParams.append("action_type", "ton_transfer");
  url.searchParams.append("action_type", "jetton_transfer");
  if (cursor) url.searchParams.set("cursor", cursor);
  const data = await read(
    url,
    source.apiKey ? { "X-API-Key": source.apiKey } : {},
  );
  if (!Array.isArray(data.actions))
    throw Error("TON Center returned invalid action history.");
  const rows = data.actions.map((a) => {
    const d = a.details;
    let action;
    if (a.type === "ton_transfer")
      action = {
        type: "TonTransfer",
        TonTransfer: {
          sender: { address: d.source },
          recipient: { address: d.destination },
          amount: d.value,
          comment: d.is_encrypted_comment ? undefined : d.comment,
        },
      };
    if (a.type === "jetton_transfer") {
      const info = data.metadata?.[d.asset]?.token_info?.find(
        (t) => t.type === "jetton_masters",
      );
      action = {
        type: "JettonTransfer",
        JettonTransfer: {
          sender: { address: d.sender },
          recipient: { address: d.receiver },
          amount: d.amount,
          comment: d.is_encrypted_comment ? undefined : d.comment,
          jetton: {
            address: d.asset,
            decimals: info?.extra?.decimals,
            symbol: info?.symbol ?? "jetton",
          },
        },
      };
    }
    return {
      event_id: Buffer.from(a.trace_id, "base64").toString("hex"),
      timestamp: a.start_utime,
      in_progress: a.finality !== "finalized",
      actions: action
        ? [
            {
              ...action,
              actionId: a.action_id,
              status: a.success ? "ok" : "failed",
            },
          ]
        : [],
    };
  });
  return { rows, next: data.next_cursor || null };
}

export async function tronscanPage(wallet, feed, cursor, since, source, read) {
  const token = feed === "trc20",
    internal = feed === "internal-transactions";
  const path = token
    ? "token_trc20/transfers"
    : internal
      ? "internal-transaction"
      : "transaction";
  const url = new URL("https://apilist.tronscanapi.com/api/" + path);
  const limit = 50,
    start = cursor?.skip ?? 0;
  if (start + limit > 10000)
    throw Error(
      "TRONSCAN pagination limit reached within one timestamp. Try TronGrid in Sources.",
    );
  url.search = new URLSearchParams({
    [token ? "relatedAddress" : "address"]: wallet,
    limit,
    start,
    confirm: token || internal ? 0 : "true",
    sort: "-timestamp",
    start_timestamp: since,
    end_timestamp: cursor?.end ?? Date.now(),
  });
  const data = await read(
    url,
    source.apiKey ? { "TRON-PRO-API-KEY": source.apiKey } : {},
  );
  const entries = token ? data.token_transfers : data.data;
  if (!Array.isArray(entries))
    throw Error("TRONSCAN returned invalid account history.");
  const rows = entries.map((r) => {
    const ok = r.confirmed === true && !r.revert && !r.rejected;
    if (token)
      return {
        type:
          ok &&
          r.contractRet === "SUCCESS" &&
          r.tokenInfo?.tokenType === "trc20"
            ? r.event_type
            : "ignored",
        block_timestamp: r.block_ts,
        transaction_id: r.transaction_id,
        from: r.from_address,
        to: r.to_address,
        value: r.quant,
        token_info: {
          address: r.contract_address,
          decimals: r.tokenInfo?.tokenDecimal,
          symbol: r.tokenInfo?.tokenAbbr,
        },
      };
    if (internal) {
      const native =
        r.valueInfoList?.find((t) => t.token_id === "_") ??
        (r.token_id === "_" ? r : null);
      return {
        block_timestamp: r.timestamp,
        tx_id: r.hash,
        internal_tx_id: r.internal_hash,
        from_address: r.from,
        to_address: r.to,
        data: {
          note: r.note,
          rejected: !ok || r.result !== "SUCCESS",
          call_value: { _: native?.call_value },
        },
      };
    }
    const type =
      Number(r.contractType) === 1
        ? "TransferContract"
        : Number(r.contractType) === 31
          ? "TriggerSmartContract"
          : null;
    return {
      block_timestamp: r.timestamp,
      txID: r.hash,
      ret: [{ contractRet: ok ? r.contractRet : "failed" }],
      raw_data: {
        data: r.data,
        contract: type ? [{ type, parameter: { value: r.contractData } }] : [],
      },
    };
  });
  let next = null;
  if (rows.length === limit) {
    const end = rows.at(-1).block_timestamp;
    const skip =
      rows.filter((r) => r.block_timestamp === end).length +
      (end === cursor?.end ? start : 0);
    next = { end, skip };
  }
  return { rows, next };
}
