import { Button, Checkbox, Input, Radio, Text } from "@cloudflare/kumo";
import { SparkleIcon, TrashIcon } from "@phosphor-icons/react";
import type { AssetMode, Direction, Network } from "../api";
import { familyLabel, guessFamily, shortAddress } from "../format";
import { familyOf, withNetworks, type AssetKind, type Errors, type RuleDraft } from "./draft";
import { TokenPicker } from "./TokenPicker";

interface Props {
  index: number;
  rule: RuleDraft;
  networks: Network[];
  errors: Errors;
  canRemove: boolean;
  onChange: (patch: Partial<RuleDraft>) => void;
  onRemove: () => void;
  onAuthLoss: (err: unknown) => boolean;
}

export function RuleEditor({ index, rule, networks, errors, canRemove, onChange, onRemove, onAuthLoss }: Props) {
  const err = (f: string) => errors[`rule.${rule.key}.${f}`];
  const families = [...new Set(networks.map((n) => n.family))];
  const selectedFamily = familyOf(rule.networks, networks);
  const guessed = guessFamily(rule.address, families);
  const selected = rule.networks.map((id) => networks.find((n) => n.id === id)).filter(Boolean) as Network[];
  const symbols = [...new Set(selected.map((n) => n.symbol))].join("/");
  const usdtMissing = selected.filter((n) => !n.usdt);
  const usdtAvailable = selected.length > 0 && usdtMissing.length === 0;
  const anyUsdt = networks.some((n) => n.usdt);

  // Show the address's family first so the most likely networks are on top.
  const orderedFamilies = [...families].sort((a, b) => {
    const rank = (f: string) => (f === selectedFamily ? 0 : f === guessed ? 1 : 2);
    return rank(a) - rank(b);
  });

  function setFamilyNetworks(family: string, ids: string[]) {
    // A rule holds one chain family; picking in a family replaces any other family's picks.
    const next = ids.filter((id) => networks.find((n) => n.id === id)?.family === family);
    const patch = withNetworks(rule, next, networks);
    const nextSel = next.map((id) => networks.find((n) => n.id === id)).filter(Boolean) as Network[];
    if (rule.assetKind === "usdt" && nextSel.some((n) => !n.usdt)) patch.assetKind = "native";
    if (family === "bitcoin" && next.length) patch.assetKind = "native";
    onChange(patch);
  }

  const suggestFamily = guessed && !selectedFamily ? guessed : null;
  const suggestIds = suggestFamily ? networks.filter((n) => n.family === suggestFamily).map((n) => n.id) : [];

  return (
    <fieldset aria-labelledby={`rule-heading-${rule.key}`} className="grid gap-5 rounded-lg px-4 pt-3 pb-4 ring ring-kumo-line">
      <div className="flex items-center justify-between gap-2">
        <span id={`rule-heading-${rule.key}`}>
          <Text as="span" bold>
            Rule {index + 1}
            {rule.address.trim() && (
              <span className="ml-2 font-mono text-[0.9em] font-normal text-kumo-subtle">
                {shortAddress(rule.address.trim(), 6, 4)}
              </span>
            )}
          </Text>
        </span>
        {canRemove && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            shape="square"
            icon={<TrashIcon />}
            aria-label={`Remove rule ${index + 1}`}
            onClick={onRemove}
          />
        )}
      </div>

      <Input
        label="Wallet address"
        value={rule.address}
        onChange={(e) => onChange({ address: e.target.value })}
        placeholder="0x…, T…, or other chain address"
        className="font-mono"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        passwordManagerIgnore
        error={err("address")}
      />

      <div className="grid gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <Text as="span" bold>
            Networks
          </Text>
          {suggestFamily && suggestIds.length > 1 && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-sm text-kumo-link hover:underline"
              onClick={() => setFamilyNetworks(suggestFamily, suggestIds)}
            >
              <SparkleIcon size={14} aria-hidden />
              Select all {familyLabel(suggestFamily)} networks
            </button>
          )}
        </div>
        <Text size="sm" variant="secondary">
          Choose one or more networks from the same chain family. The address is watched on each.
        </Text>
        {networks.length === 0 ? (
          <Text variant="secondary">The server didn't report any supported networks.</Text>
        ) : (
          <div className="grid gap-3">
            {orderedFamilies
              .filter((family) => selectedFamily === null || family === selectedFamily)
              .map((family) => {
                const list = networks.filter((n) => n.family === family);
                return (
                  <Checkbox.Group
                    key={family}
                    legend={familyLabel(family)}
                    orientation="horizontal"
                    value={rule.networks.filter((id) => list.some((n) => n.id === id))}
                    onValueChange={(ids) => setFamilyNetworks(family, ids)}
                    className="gap-y-2"
                  >
                    {list.map((n) => (
                      <Checkbox.Item key={n.id} value={n.id} label={n.name} />
                    ))}
                  </Checkbox.Group>
                );
              })}
            {selectedFamily !== null && families.length > 1 && (
              <Text size="sm" variant="secondary">
                Other chains aren't compatible with {familyLabel(selectedFamily)} networks.{" "}
                <button
                  type="button"
                  className="text-kumo-link hover:underline"
                  onClick={() =>
                    onChange({ ...withNetworks(rule, [], networks), assetKind: rule.assetKind === "usdt" ? "native" : rule.assetKind })
                  }
                >
                  Clear to choose another chain
                </button>
              </Text>
            )}
          </div>
        )}
        {err("networks") && <Text variant="error" size="sm">{err("networks")}</Text>}
      </div>

      <Radio.Group
        legend="Direction"
        appearance="segmented"
        orientation="horizontal"
        value={rule.direction}
        onValueChange={(v) => onChange({ direction: v as Direction })}
      >
        <Radio.Item label="Received" value="received" />
        <Radio.Item label="Sent" value="sent" />
        <Radio.Item label="Both" value="both" />
      </Radio.Group>

      <div className="grid gap-3">
        <Radio.Group
          legend="Assets"
          appearance="segmented"
          orientation="horizontal"
          value={rule.assetMode}
          onValueChange={(v) => onChange({ assetMode: v as AssetMode })}
        >
          <Radio.Item label="All" value="all" />
          <Radio.Item label="Only" value="include" />
          <Radio.Item label="All except" value="exclude" />
        </Radio.Group>

        {rule.assetMode !== "all" && (
          <div className="grid gap-3 border-l-2 border-kumo-line pl-4">
            <Radio.Group
              legend={rule.assetMode === "include" ? "Alert only for" : "Ignore transfers of"}
              value={rule.assetKind}
              onValueChange={(v) => onChange({ assetKind: v as AssetKind })}
              error={err("asset")}
            >
              <Radio.Item label={symbols ? `Native coin (${symbols})` : "Native coin"} value="native" />
              {anyUsdt && (
                <Radio.Item
                  label={
                    usdtAvailable
                      ? "USDT (verified contract)"
                      : selected.length === 0
                        ? "USDT (verified contract) · pick networks first"
                        : `USDT · not verified on ${usdtMissing.map((n) => n.name).join(", ")}`
                  }
                  value="usdt"
                  disabled={!usdtAvailable}
                />
              )}
              <Radio.Item label="Token from catalog" value="catalog" disabled={selectedFamily === "bitcoin"} />
              <Radio.Item label="Token contract (manual)" value="contract" disabled={selectedFamily === "bitcoin"} />
            </Radio.Group>

            {rule.assetKind === "usdt" && usdtAvailable && (
              <ul className="grid gap-1">
                {selected.flatMap((n) => [n.usdt!, ...(n.additionalUsdt ?? [])].map((contract) => (
                  <li key={n.id + contract} className="flex min-w-0 items-baseline gap-2 text-sm">
                    <span className="shrink-0 text-kumo-subtle">{n.name}</span>
                    <span className="truncate font-mono text-[0.9em]" title={contract}>
                      {contract}
                    </span>
                  </li>
                )))}
              </ul>
            )}

            {rule.assetKind === "catalog" && (
              <TokenPicker
                selected={selected}
                family={selectedFamily}
                token={rule.token}
                notice={rule.tokenNotice}
                hint={rule.tokenHint}
                error={err("token")}
                onPick={(token) => onChange({ token, tokenNotice: null })}
                onAuthLoss={onAuthLoss}
              />
            )}

            {rule.assetKind === "contract" && (
              <Input
                label="Contract address"
                value={rule.contract}
                onChange={(e) => onChange({ contract: e.target.value })}
                placeholder={selectedFamily === "tron" ? "T…" : "0x…"}
                className="font-mono"
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                passwordManagerIgnore
                error={err("contract")}
                description={
                  selected.length > 1
                    ? "The same contract address is matched on every selected network. Token contracts usually differ per chain, so a single network is safer."
                    : "The token's contract on the selected network."
                }
              />
            )}
          </div>
        )}
      </div>
    </fieldset>
  );
}
