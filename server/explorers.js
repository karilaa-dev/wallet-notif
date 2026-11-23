// Account-history APIs return newest-first pages. Pin each continuation to its
// boundary block so new blocks arriving between requests cannot shift offsets.
const actions = {
  transactions: "txlist",
  "internal-transactions": "txlistinternal",
  "token-transfers": "tokentx",
};
export async function explorerPage(net, wallet, feed, cursor, source, read) {
  if (source.provider === "etherscan" && !source.apiKey)
    throw Error("Add an Etherscan API key in Sources for this network.");
  const etherscan = source.provider === "etherscan";
  const url = new URL(
    etherscan
      ? "https://api.etherscan.io/v2/api"
      : "https://api.routescan.io/v2/network/mainnet/evm/" +
          net.chainId +
          "/etherscan/api",
  );
  const size = 100,
    skip = cursor?.skip ?? 0;
  url.search = new URLSearchParams({
    module: "account",
    action: actions[feed],
    address: wallet,
    endblock: cursor?.endblock ?? 9999999999,
    sort: "desc",
    page: 1 + Math.floor(skip / size),
    offset: size,
  });
  if (etherscan) url.searchParams.set("chainid", net.chainId);
  if (source.apiKey) url.searchParams.set("apikey", source.apiKey);
  const data = await read(url, {});
  if (
    data.status === "0" &&
    /no transactions|no records/i.test(data.message) &&
    Array.isArray(data.result) &&
    !data.result.length
  )
    return { rows: [], next: null };
  if (data.status !== "1" || !Array.isArray(data.result))
    throw Error(
      "Explorer rejected the history request. Check the key, chain coverage and rate limits in Sources.",
    );
  const entries = data.result.slice(skip % size);
  let next = null;
  if (data.result.length === size) {
    const endblock = data.result.at(-1).blockNumber;
    if (!/^\d+$/.test(endblock))
      throw Error("Explorer returned an invalid block number.");
    const count = entries.filter((r) => r.blockNumber === endblock).length;
    next = {
      endblock,
      skip: count + (cursor?.endblock === endblock ? skip : 0),
    };
  }
  return {
    rows: entries.map((r) => {
      const common = {
        timestamp: new Date(Number(r.timeStamp) * 1000).toISOString(),
        from: { hash: r.from },
        to: { hash: r.to || r.contractAddress },
        value: r.value,
        transaction_hash: r.hash,
      };
      if (feed === "transactions")
        return {
          ...common,
          hash: r.hash,
          status:
            r.isError === "0" && r.txreceipt_status !== "0" ? "ok" : "failed",
        };
      if (feed === "internal-transactions")
        return {
          ...common,
          index: r.traceId,
          accountTrace: true,
          success: r.isError === "0",
          type: r.type,
        };
      return {
        ...common,
        accountToken: true,
        log_index: r.logIndex,
        token: {
          type: "ERC-20",
          address_hash: r.contractAddress,
          symbol: r.tokenSymbol,
          decimals: r.tokenDecimal,
        },
        total: { value: r.value, decimals: r.tokenDecimal },
      };
    }),
    next,
  };
}
