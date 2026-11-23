import { networks } from "./networks.js";

function option(id, name, description, key = "none", custom = false) {
  return { id, name, description, key, custom };
}
const presets = {
  blockscout: option(
    "blockscout",
    "Blockscout public explorer",
    "Public indexed transfers. Availability and limits vary by network.",
  ),
  pro: option(
    "pro",
    "Blockscout PRO",
    "Authenticated Blockscout multichain API.",
    "required",
  ),
  etherscan: option(
    "etherscan",
    "Etherscan V2",
    "Native, internal and ERC-20 history. Some networks require a paid Etherscan plan.",
    "required",
  ),
  routescan: option(
    "routescan",
    "Routescan",
    "Public indexed transfer history. Add a Routescan key for higher limits.",
    "optional",
  ),
  toncenter: option(
    "toncenter",
    "TON Center",
    "Indexed TON and jetton actions from TON Center v3.",
    "optional",
  ),
  tronscan: option(
    "tronscan",
    "TRONSCAN",
    "Native, internal and token transfers from the TRONSCAN explorer.",
    "optional",
  ),
  tonapi: option(
    "tonapi",
    "TonAPI",
    "TON transfers and jetton actions. Accepts a Tonconsole API token.",
    "optional",
  ),
  trongrid: option(
    "trongrid",
    "TronGrid",
    "Confirmed TRX and TRC-20 transfers. Add a TronGrid key for authenticated access.",
    "optional",
  ),
  blockstream: option(
    "blockstream",
    "Blockstream Esplora",
    "Public confirmed Bitcoin transaction history.",
  ),
  mempool: option(
    "mempool",
    "mempool.space",
    "Public Esplora-compatible Bitcoin address history.",
  ),
};
export function optionsFor(net) {
  let ids,
    protocol,
    key = "none";
  if (net.family === "evm") {
    ids = net.host ? ["blockscout", "pro", "etherscan"] : ["etherscan"];
    if (net.id === "ethereum") ids.push("routescan");
    if (net.id === "avalanche") ids.unshift("routescan");
    protocol = "Blockscout v2";
    key = "optional";
  } else if (net.family === "ton") {
    ids = ["tonapi", "toncenter"];
    protocol = "TonAPI v2";
    key = "optional";
  } else if (net.family === "tron") {
    ids = ["trongrid", "tronscan"];
    protocol = "TronGrid v1";
    key = "optional";
  } else {
    ids = ["blockstream", "mempool"];
    protocol = "Esplora";
  }
  return [
    ...ids.map((id) => presets[id]),
    option(
      "custom",
      "Custom " + protocol,
      "Base URL of a compatible " + protocol + " indexer for this mainnet.",
      key,
      true,
    ),
  ];
}
export function defaultSource(net) {
  return { provider: optionsFor(net)[0].id, apiKey: "", url: "" };
}
function legacySource(net, env) {
  const source = defaultSource(net);
  const override = env[net.id.toUpperCase() + "_API_URL"];
  if (override) {
    source.provider = "custom";
    source.url = override;
  }
  if (net.family === "evm" && net.host && !override && env.BLOCKSCOUT_API_KEY) {
    source.provider = "pro";
    source.apiKey = env.BLOCKSCOUT_API_KEY;
  }
  if (net.family === "ton") source.apiKey = env.TON_API_KEY || "";
  if (net.family === "tron") source.apiKey = env.TRONGRID_API_KEY || "";
  return source;
}

export class Sources {
  constructor(db, env = process.env) {
    this.db = db;
    db.exec(
      "CREATE TABLE IF NOT EXISTS sources(network TEXT PRIMARY KEY, settings TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1)",
    );
    const insert = db.prepare(
      "INSERT OR IGNORE INTO sources(network,settings) VALUES(?,?)",
    );
    for (const net of networks)
      insert.run(net.id, JSON.stringify(legacySource(net, env)));
  }
  get(id) {
    const row = this.db
      .prepare("SELECT settings,revision FROM sources WHERE network=?")
      .get(id);
    return { ...JSON.parse(row.settings), revision: row.revision };
  }
  list() {
    return networks.map((net) => {
      const { provider, url, apiKey } = this.get(net.id);
      return {
        network: net.id,
        provider,
        hasUrl: !!url,
        hasKey: !!apiKey,
        options: optionsFor(net),
      };
    });
  }
  save(net, input) {
    const chosen = optionsFor(net).find((p) => p.id === input?.provider);
    if (!chosen) throw Error("Choose a supported transaction source.");
    const old = this.get(net.id);
    const same = old.provider === chosen.id;
    let url = "",
      apiKey = "";
    if (chosen.custom) {
      const supplied = input.url === undefined && same ? old.url : input.url;
      let parsed;
      try {
        parsed = new URL(supplied);
      } catch {
        throw Error("Enter a valid indexer base URL.");
      }
      if (
        !["https:", "http:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        parsed.href.length > 4096
      )
        throw Error(
          "Use an HTTP or HTTPS base URL without a query string, fragment or user information.",
        );
      url = parsed.href.replace(/\/+$/, "");
    }
    if (chosen.key !== "none") {
      apiKey =
        input.apiKey === undefined &&
        same &&
        (!chosen.custom || input.url === undefined)
          ? old.apiKey
          : (input.apiKey ?? "");
      if (typeof apiKey !== "string" || !/^[\x21-\x7e]{0,1024}$/.test(apiKey))
        throw Error("Enter a valid API key.");
      if (!apiKey && chosen.key === "required")
        throw Error("This source requires an API key.");
    }
    this.db
      .prepare(
        "UPDATE sources SET settings=?,revision=revision+1 WHERE network=?",
      )
      .run(JSON.stringify({ provider: chosen.id, url, apiKey }), net.id);
    this.db
      .prepare(
        "UPDATE watches SET due=0,failures=0,error=NULL,updated=NULL WHERE network=?",
      )
      .run(net.id);
  }
}
