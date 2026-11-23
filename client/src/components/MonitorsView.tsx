import { useMemo } from "react";
import { Badge, Empty, LayerCard, Text } from "@cloudflare/kumo";
import { BinocularsIcon } from "@phosphor-icons/react";
import type { Monitor, Network } from "../api";
import { Tip } from "./Tip";
import { absoluteTime, humanize, relativeTime, shortAddress, statusTone, type Tone } from "../format";

const ORDER: Record<Tone, number> = { error: 0, warning: 1, neutral: 2, success: 3 };

export function MonitorsView({ monitors, networks }: { monitors: Monitor[]; networks: Network[] }) {
  // Group by wallet so each address reads as one unit, problems first.
  const groups = useMemo(() => {
    const map = new Map<string, { address: string; items: (Monitor & { tone: Tone; netName: string })[] }>();
    for (const m of monitors) {
      const key = m.address;
      const tone: Tone = m.error ? "error" : statusTone(m.status);
      const netName = networks.find((n) => n.id === m.network)?.name ?? m.network;
      const g = map.get(key) ?? { address: m.address, items: [] };
      g.items.push({ ...m, tone, netName });
      map.set(key, g);
    }
    const list = [...map.values()];
    for (const g of list) g.items.sort((a, b) => ORDER[a.tone] - ORDER[b.tone] || a.netName.localeCompare(b.netName));
    list.sort((a, b) => ORDER[a.items[0].tone] - ORDER[b.items[0].tone] || a.address.localeCompare(b.address));
    return list;
  }, [monitors, networks]);

  if (monitors.length === 0) {
    return (
      <LayerCard className="px-5 py-10">
        <Empty
          icon={<BinocularsIcon size={40} />}
          title="Nothing is being monitored"
          description="Monitors start automatically for each wallet and network used in a destination's rules."
        />
      </LayerCard>
    );
  }

  return (
    <div className="grid gap-4">
      {groups.map((g) => (
        <section key={g.address} className="grid gap-2" aria-label={`Monitors for ${g.address}`}>
          <Tip content={g.address}>
            <span className="w-fit max-w-full truncate px-1 font-mono text-[13px] text-kumo-subtle">
              <span className="sm:hidden">{shortAddress(g.address, 10, 8)}</span>
              <span className="hidden sm:inline">{g.address}</span>
            </span>
          </Tip>
          <LayerCard className="p-0">
            <ul className="divide-y divide-kumo-line">
              {g.items.map((m) => (
                <li
                  key={m.network}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[12rem_8rem_1fr_auto]"
                >
                  <Text bold truncate>
                    {m.netName}
                  </Text>
                  <span className="justify-self-end sm:justify-self-start">
                    <Badge appearance="dot" variant={m.tone}>
                      {humanize(m.status)}
                    </Badge>
                  </span>
                  {m.error ? (
                    <Text as="span" size="sm" variant="error" DANGEROUS_className="col-span-2 min-w-0 break-words sm:col-span-1">
                      {m.error}
                    </Text>
                  ) : (
                    <span className="hidden sm:block" />
                  )}
                  <Tip content={m.updatedAt ? absoluteTime(m.updatedAt) : "No update yet"}>
                    <time
                      dateTime={m.updatedAt ?? undefined}
                      className="col-span-2 text-sm text-kumo-subtle tabular-nums sm:col-span-1 sm:text-right"
                    >
                      {m.updatedAt ? `Updated ${relativeTime(m.updatedAt)}` : "Waiting for first check"}
                    </time>
                  </Tip>
                </li>
              ))}
            </ul>
          </LayerCard>
        </section>
      ))}
    </div>
  );
}
