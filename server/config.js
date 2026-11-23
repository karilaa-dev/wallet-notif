import { byId, normalize } from "./networks.js";

function string(value, label, max = 256) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw Error("Enter a valid " + label + ".");
  return value.trim();
}
function httpUrl(value, label) {
  let u;
  try {
    u = new URL(string(value, label, 4096));
  } catch {
    throw Error("Enter a valid " + label + ".");
  }
  if (
    !["https:", "http:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.hash
  )
    throw Error(
      "Use an HTTP or HTTPS " +
        label +
        " without embedded credentials or fragment.",
    );
  return u.href;
}
function rule(input) {
  const ids = input?.networks;
  if (!Array.isArray(ids) || !ids.length || ids.some((id) => !byId.has(id)))
    throw Error("Select a supported network.");
  const nets = [...new Set(ids)].map((id) => byId.get(id));
  const family = nets[0].family;
  if (nets.some((n) => n.family !== family))
    throw Error("Use a separate rule for each address format.");
  const direction = input.direction ?? "received",
    assetMode = input.assetMode ?? "all";
  if (
    !["received", "sent", "both"].includes(direction) ||
    !["all", "include", "exclude"].includes(assetMode)
  )
    throw Error("Invalid transfer filter.");
  let asset = "native",
    token;
  if (assetMode !== "all") {
    asset = input.asset;
    if (asset === "usdt" && nets.some((n) => !n.usdt))
      throw Error(
        "The USDT preset is unavailable on one of the selected networks.",
      );
    if (asset === "catalog") {
      if (family === "bitcoin")
        throw Error("Bitcoin supports native BTC transfers.");
      const id = string(input.token?.id, "catalog token ID", 180);
      token = {
        id,
        contracts: Object.fromEntries(
          nets.map((n) => [
            n.id,
            normalize(family, input.token?.contracts?.[n.id]),
          ]),
        ),
      };
    } else if (asset !== "native" && asset !== "usdt") {
      if (family === "bitcoin")
        throw Error("Bitcoin supports native BTC transfers.");
      asset = normalize(family, asset);
    }
  }
  return {
    address: normalize(family, input.address),
    networks: nets.map((n) => n.id),
    direction,
    assetMode,
    asset,
    ...(token ? { token } : {}),
  };
}
export function validate(input, previous) {
  const name = string(input?.name, "destination name", 100),
    type = input.type;
  const c = input.config ?? {},
    old = previous?.type === type ? previous.config : {};
  let config;
  if (type === "webhook")
    config = { url: httpUrl(c.url || old.url, "webhook URL") };
  else if (type === "ntfy") {
    const server = httpUrl(c.server || "https://ntfy.sh", "ntfy server");
    if (new URL(server).search)
      throw Error("Use the ntfy server URL without query parameters.");
    const priority = Number(c.priority ?? 3),
      topic = string(c.topic, "ntfy topic");
    if (
      !/^[a-zA-Z0-9_-]{1,64}$/.test(topic) ||
      !Number.isInteger(priority) ||
      priority < 1 ||
      priority > 5
    )
      throw Error("Enter a valid topic and a priority between 1 and 5.");
    const token = c.token === null ? "" : c.token || old.token || "";
    if (token && !/^[\x21-\x7e]{1,512}$/.test(token))
      throw Error("Invalid ntfy token.");
    if (old.token && server !== old.server && !c.token && c.token !== null)
      throw Error("Re-enter or clear the token when changing ntfy servers.");
    config = { server, topic, priority, token };
  } else if (type === "telegram") {
    const botToken = string(c.botToken || old.botToken, "Telegram bot token");
    if (!/^\d+:[\w-]+$/.test(botToken))
      throw Error("Enter a valid Telegram bot token.");
    config = {
      botToken,
      chatId: string(String(c.chatId ?? ""), "Telegram chat ID"),
    };
  } else throw Error("Unknown destination type.");
  if (!Array.isArray(input.rules) || input.rules.length > 250)
    throw Error("Provide up to 250 wallet rules.");
  return { name, type, config, rules: input.rules.map(rule) };
}
export function publicDestination({ id, name, type, config, rules }) {
  const { url, botToken, token, ...safe } = config;
  return {
    id,
    name,
    type,
    rules: rules.map(({ since, ...rule }) => rule),
    config: type === "ntfy" ? { ...safe, hasToken: Boolean(token) } : safe,
  };
}
export function selectedAssets(rule, networkId) {
  if (rule.asset === "catalog") return [rule.token.contracts[networkId]];
  if (rule.asset !== "usdt") return [rule.asset];
  const network = byId.get(networkId);
  return [network.usdt, ...(network.additionalUsdt ?? [])];
}
export function matches(rule, transfer) {
  if (
    rule.address !== transfer.wallet ||
    !rule.networks.includes(transfer.network)
  )
    return false;
  if (rule.direction !== "both" && rule.direction !== transfer.direction)
    return false;
  if (rule.assetMode === "all") return true;
  const selected = selectedAssets(rule, transfer.network).includes(
    transfer.asset,
  );
  return selected === (rule.assetMode === "include");
}
