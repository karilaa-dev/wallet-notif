import { Address } from "@ton/core";
import { byId } from "./networks.js";

const explorers = {
  ethereum: "https://etherscan.io/tx/",
  base: "https://basescan.org/tx/",
  arbitrum: "https://arbiscan.io/tx/",
  optimism: "https://optimistic.etherscan.io/tx/",
  polygon: "https://polygonscan.com/tx/",
  bsc: "https://bscscan.com/tx/",
  avalanche: "https://snowtrace.io/tx/",
  ton: "https://tonviewer.com/transaction/",
  tron: "https://tronscan.org/#/transaction/",
  bitcoin: "https://mempool.space/tx/",
};

function shortAddress(network, address, bounceable) {
  let display = address;
  if (network === "ton" && Address.isRaw(address)) {
    display = Address.parseRaw(address).toString({ bounceable });
  }
  return display.length > 15 ? display.slice(0, 8) + "…" + display.slice(-6) : display;
}

export function transferNotification(event) {
  const { wallet, network, transaction, amount, symbol, asset } = event;
  const net = byId.get(network);
  const sent = event.direction === "sent";
  let verb = sent ? "📤 Sent" : "📥 Received";
  if (network === "bitcoin") verb = sent ? "📤 Net outflow of" : "📥 Net inflow of";
  if (event.from === wallet && event.to === wallet) verb = "🔁 Self-transfer of";
  const networkLabel = asset === "native" && net?.name === symbol ? "" : " on " + (net?.name ?? network);
  const lines = [
    verb + " " + amount + " " + symbol + networkLabel,
    "👛 Wallet " + shortAddress(network, wallet, false),
  ];
  if (asset !== "native") lines.push("Token contract " + shortAddress(network, asset, true));
  const validHash = net?.family === "evm" ? /^0x[\da-f]{64}$/i : /^[\da-f]{64}$/i;
  const transactionUrl = net && validHash.test(transaction) ? explorers[network] + transaction : null;
  if (!transactionUrl) lines.push("Transaction " + transaction);
  if (event.comment) lines.push("💬 Comment: " + event.comment);
  return { message: lines.join("\n"), transactionUrl };
}
