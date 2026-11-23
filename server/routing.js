import { matches, selectedAssets } from "./config.js";

const directions = ["received", "sent"];

function scopeKey(network, wallet, direction) {
  return JSON.stringify([network, wallet, direction]);
}

function sinceFor(scope, asset) {
  if (!scope) return null;
  return Object.hasOwn(scope.assets, asset)
    ? scope.assets[asset]
    : scope.defaultSince;
}

// Each scope has a start time for ordinary assets and overrides for contracts
// mentioned by a rule. An explicit null means the asset is excluded.
export function compileCoverage(rules, now, previous = {}) {
  const groups = new Map();
  for (const rule of rules) {
    for (const network of rule.networks) {
      for (const direction of directions) {
        if (rule.direction !== "both" && rule.direction !== direction) continue;
        const wallet = rule.address;
        const key = scopeKey(network, wallet, direction);
        const group = groups.get(key) ?? {
          network,
          wallet,
          direction,
          rules: [],
          assets: new Set(Object.keys(previous[key]?.assets ?? {})),
        };
        group.rules.push(rule);
        if (rule.assetMode !== "all") {
          for (const asset of selectedAssets(rule, network))
            group.assets.add(asset);
        }
        groups.set(key, group);
      }
    }
  }

  const coverage = {};
  for (const [key, group] of groups) {
    function startTime(asset) {
      let earliest = Infinity;
      for (const rule of group.rules) {
        if (
          !matches(rule, {
            network: group.network,
            wallet: group.wallet,
            direction: group.direction,
            asset,
          })
        )
          continue;
        // Earlier databases stored a scalar or per-network start on each rule.
        const legacy =
          typeof rule.since === "number"
            ? rule.since
            : rule.since?.[group.network];
        earliest = Math.min(earliest, legacy ?? now);
      }
      if (earliest === Infinity) return null;
      return Math.min(earliest, sinceFor(previous[key], asset) ?? earliest);
    }
    // '*' cannot be a valid contract or native asset identifier.
    const defaultSince = startTime("*");
    const assets = {};
    for (const asset of group.assets) {
      const since = startTime(asset);
      if (since !== defaultSince) assets[asset] = since;
    }
    coverage[key] = { defaultSince, assets };
  }
  return coverage;
}

export function coversEvent(coverage, event) {
  const scope =
    coverage[scopeKey(event.network, event.wallet, event.direction)];
  const since = sinceFor(scope, event.asset);
  return since !== null && Date.parse(event.timestamp) >= since;
}
