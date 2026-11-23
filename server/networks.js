import { createHash } from "node:crypto";
import { base58check } from "@scure/base";
import { Address } from "@ton/core";
import { address as bitcoin } from "bitcoinjs-lib";

const tronCodec = base58check((bytes) =>
  createHash("sha256").update(bytes).digest(),
);
export function normalize(family, value) {
  const input = typeof value === "string" ? value.trim() : "";
  try {
    if (family === "evm" && /^0x[\da-f]{40}$/i.test(input))
      return input.toLowerCase();
    if (family === "bitcoin") {
      bitcoin.toOutputScript(input);
      return /^bc1/i.test(input) ? input.toLowerCase() : input;
    }
    if (family === "ton") {
      if (!Address.isRaw(input) && Address.parseFriendly(input).isTestOnly)
        throw Error();
      return Address.parse(input).toRawString();
    }
    if (family === "tron") {
      const bytes = /^41[\da-f]{40}$/i.test(input)
        ? Buffer.from(input, "hex")
        : tronCodec.decode(input);
      if (bytes.length === 21 && bytes[0] === 0x41)
        return tronCodec.encode(bytes);
    }
  } catch {
    /* Report one actionable validation error for each family. */
  }
  throw Error("Invalid " + family.toUpperCase() + " mainnet address.");
}

function evm(id, name, chainId, symbol, host, usdt, additionalUsdt = []) {
  return {
    id,
    name,
    chainId,
    symbol,
    family: "evm",
    host,
    additionalUsdt,
    usdt: usdt?.toLowerCase() ?? null,
  };
}
export const networks = [
  evm(
    "ethereum",
    "Ethereum",
    1,
    "ETH",
    "eth.blockscout.com",
    "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  ),
  evm(
    "base",
    "Base",
    8453,
    "ETH",
    "base.blockscout.com",
    "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
  ),
  evm(
    "arbitrum",
    "Arbitrum One",
    42161,
    "ETH",
    "arbitrum.blockscout.com",
    "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  ),
  evm(
    "optimism",
    "OP Mainnet",
    10,
    "ETH",
    "explorer.optimism.io",
    "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
    ["0x01bff41798a0bcf287b996046ca68b395dbc1071"],
  ),
  evm(
    "polygon",
    "Polygon PoS",
    137,
    "POL",
    "polygon.blockscout.com",
    "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
  ),
  evm(
    "bsc",
    "BNB Smart Chain",
    56,
    "BNB",
    null,
    "0x55d398326f99059ff775485246999027b3197955",
  ),
  evm(
    "avalanche",
    "Avalanche C-Chain",
    43114,
    "AVAX",
    null,
    "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7",
  ),
  {
    id: "ton",
    name: "TON",
    family: "ton",
    symbol: "TON",
    host: "tonapi.io",
    usdt: normalize("ton", "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs"),
  },
  {
    id: "tron",
    name: "TRON",
    family: "tron",
    symbol: "TRX",
    host: "api.trongrid.io",
    usdt: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  },
  {
    id: "bitcoin",
    name: "Bitcoin",
    family: "bitcoin",
    symbol: "BTC",
    host: "blockstream.info/api",
    usdt: null,
  },
];
export const byId = new Map(networks.map((n) => [n.id, n]));
