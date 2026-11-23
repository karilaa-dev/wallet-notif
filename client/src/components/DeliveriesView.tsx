import { useMemo, useState } from "react";
import { Badge, Empty, LayerCard, Select, Table, Tabs, Text } from "@cloudflare/kumo";
import { TrayIcon } from "@phosphor-icons/react";
import type { Delivery, Destination } from "../api";
import { Tip } from "./Tip";
import { absoluteTime, humanize, relativeTime, statusTone } from "../format";

const ALL = "__all__";

export function DeliveriesView({ deliveries, destinations }: { deliveries: Delivery[]; destinations: Destination[] }) {
  const [dest, setDest] = useState<string>(ALL);
  const [only, setOnly] = useState<"all" | "failed">("all");

  const options = Object.fromEntries(destinations.map((d) => [d.id, d.name]));

  const rows = useMemo(
    () =>
      [...deliveries]
        .filter((d) => dest === ALL || d.destinationId === dest)
        .filter((d) => only === "all" || statusTone(d.status) === "error")
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [deliveries, dest, only],
  );

  if (deliveries.length === 0) {
    return (
      <LayerCard className="px-5 py-10">
        <Empty
          icon={<TrayIcon size={40} />}
          title="No deliveries yet"
          description="Every alert and test message sent to a destination shows up here, including failures."
        />
      </LayerCard>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Filter by destination"
          className="min-w-44"
          value={dest}
          onValueChange={(v) => setDest((v as string) ?? ALL)}
          items={{ [ALL]: "All destinations", ...options }}
        />
        <Tabs
          size="sm"
          value={only}
          onValueChange={(v) => setOnly(v as "all" | "failed")}
          tabs={[
            { value: "all", label: "All" },
            { value: "failed", label: "Failed" },
          ]}
        />
        <Text as="span" size="sm" variant="secondary" DANGEROUS_className="ml-auto tabular-nums">
          {rows.length} of {deliveries.length}
        </Text>
      </div>

      {rows.length === 0 ? (
        <LayerCard className="px-5 py-6">
          <Text variant="secondary">No deliveries match these filters.</Text>
        </LayerCard>
      ) : (
        <>
          {/* Desktop: table */}
          <LayerCard className="hidden overflow-hidden p-0 md:block">
            <Table layout="fixed">
              <colgroup>
                <col className="w-32" />
                <col className="w-44" />
                <col />
                <col className="w-32" />
              </colgroup>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Status</Table.Head>
                  <Table.Head>Destination</Table.Head>
                  <Table.Head>Summary</Table.Head>
                  <Table.Head className="text-right">When</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {rows.map((d) => (
                  <Table.Row key={d.id}>
                    <Table.Cell>
                      <Badge appearance="dot" variant={statusTone(d.status)}>
                        {humanize(d.status)}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="block truncate">{d.destinationName}</span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="block break-words">{d.summary}</span>
                      {d.error && <span className="mt-0.5 block break-words text-sm text-kumo-danger">{d.error}</span>}
                    </Table.Cell>
                    <Table.Cell className="text-right">
                      <Tip content={absoluteTime(d.createdAt)}>
                        <time dateTime={d.createdAt} className="text-kumo-subtle tabular-nums">
                          {relativeTime(d.createdAt)}
                        </time>
                      </Tip>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </LayerCard>

          {/* Mobile: stacked list */}
          <LayerCard className="p-0 md:hidden">
            <ul className="divide-y divide-kumo-line">
              {rows.map((d) => (
                <li key={d.id} className="grid gap-1 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge appearance="dot" variant={statusTone(d.status)}>
                      {humanize(d.status)}
                    </Badge>
                    <time dateTime={d.createdAt} className="text-sm text-kumo-subtle tabular-nums" title={absoluteTime(d.createdAt)}>
                      {relativeTime(d.createdAt)}
                    </time>
                  </div>
                  <Text bold>{d.destinationName}</Text>
                  <Text variant="secondary" DANGEROUS_className="break-words">{d.summary}</Text>
                  {d.error && <Text variant="error" size="sm" DANGEROUS_className="break-words">{d.error}</Text>}
                </li>
              ))}
            </ul>
          </LayerCard>
        </>
      )}
    </div>
  );
}
