import { useMemo, useState } from "react";
import { Badge, Button, Empty, LayerCard, Text } from "@cloudflare/kumo";
import { DatabaseIcon, GearSixIcon } from "@phosphor-icons/react";
import type { Network, NetworkSource, SourceOption } from "../api";
import { familyLabel } from "../format";
import { SourceEditor } from "./SourceEditor";

interface Props {
  sources: NetworkSource[];
  networks: Network[];
  onChanged: () => Promise<void>;
  onAuthLoss: (err: unknown) => boolean;
}

export type SourceHealth = "ok" | "needs-key" | "needs-url" | "unknown";

export function activeOption(s: NetworkSource): SourceOption | undefined {
  return s.options.find((o) => o.id === s.provider);
}

/** Whether the active provider has what it needs to run. */
export function sourceHealth(s: NetworkSource): SourceHealth {
  const opt = activeOption(s);
  if (!opt) return "unknown";
  if (opt.custom && !s.hasUrl) return "needs-url";
  if (opt.key === "required" && !s.hasKey) return "needs-key";
  return "ok";
}

export function SourcesView({ sources, networks, onChanged, onAuthLoss }: Props) {
  const [editing, setEditing] = useState<NetworkSource | null>(null);
  const [open, setOpen] = useState(false);

  // Group rows by chain family, in the server's network order.
  const groups = useMemo(() => {
    const order = new Map(networks.map((n, i) => [n.id, i]));
    const sorted = [...sources].sort((a, b) => (order.get(a.network) ?? 1e9) - (order.get(b.network) ?? 1e9));
    const map = new Map<string, NetworkSource[]>();
    for (const s of sorted) {
      const fam = networks.find((n) => n.id === s.network)?.family ?? "other";
      map.set(fam, [...(map.get(fam) ?? []), s]);
    }
    return [...map.entries()];
  }, [sources, networks]);

  if (sources.length === 0) {
    return (
      <LayerCard className="px-5 py-10">
        <Empty
          icon={<DatabaseIcon size={40} />}
          title="No transaction sources reported"
          description="The server didn't list any configurable sources. Update the server to manage providers here."
        />
      </LayerCard>
    );
  }

  const current = editing ? (sources.find((s) => s.network === editing.network) ?? editing) : null;

  return (
    <div className="grid gap-4">
      <Text variant="secondary">
        Choose a transaction provider for each network. Monitors use the new provider on their next poll.
      </Text>
      {groups.map(([family, list]) => (
        <section key={family} className="grid gap-2" aria-label={`${familyLabel(family)} sources`}>
          <Text as="h3" size="sm" variant="secondary" DANGEROUS_className="px-1 font-medium">
            {familyLabel(family)}
          </Text>
          <LayerCard className="p-0">
            <ul className="divide-y divide-kumo-line">
              {list.map((s) => (
                <SourceRow
                  key={s.network}
                  source={s}
                  networkName={networks.find((n) => n.id === s.network)?.name ?? s.network}
                  onEdit={() => {
                    setEditing(s);
                    setOpen(true);
                  }}
                />
              ))}
            </ul>
          </LayerCard>
        </section>
      ))}

      <SourceEditor
        open={open}
        onOpenChange={setOpen}
        source={current}
        networkName={current ? (networks.find((n) => n.id === current.network)?.name ?? current.network) : ""}
        onSaved={onChanged}
        onAuthLoss={onAuthLoss}
      />
    </div>
  );
}

function SourceRow({ source, networkName, onEdit }: { source: NetworkSource; networkName: string; onEdit: () => void }) {
  const opt = activeOption(source);
  const health = sourceHealth(source);
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[10rem_1fr_auto]">
      <Text bold truncate>
        {networkName}
      </Text>
      <div className="col-span-2 row-start-2 grid min-w-0 gap-1 sm:col-span-1 sm:row-start-auto">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Text as="span" truncate>
            {opt?.name ?? source.provider}
          </Text>
          <SourceBadges source={source} option={opt} health={health} />
        </div>
        {opt?.description && (
          <Text as="span" size="sm" variant="secondary" DANGEROUS_className="line-clamp-2">
            {opt.description}
          </Text>
        )}
      </div>
      <Button
        variant="secondary"
        size="sm"
        icon={<GearSixIcon />}
        onClick={onEdit}
        aria-label={`Configure ${networkName} source`}
        className="justify-self-end"
      >
        Configure
      </Button>
    </li>
  );
}

function SourceBadges({ source, option, health }: { source: NetworkSource; option?: SourceOption; health: SourceHealth }) {
  if (health === "unknown") return <Badge variant="warning">Unknown provider</Badge>;
  if (health === "needs-url") return <Badge variant="error">Needs endpoint URL</Badge>;
  if (health === "needs-key") return <Badge variant="error">Needs API key</Badge>;
  return (
    <>
      {option?.key !== "none" && source.hasKey && <Badge variant="neutral">Key saved</Badge>}
      {option?.custom && source.hasUrl && <Badge variant="neutral">Custom URL</Badge>}
    </>
  );
}
