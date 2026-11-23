import { useState } from "react";
import {
  Badge,
  Button,
  DropdownMenu,
  Empty,
  LayerCard,
  LayerDialog,
  Text,

  useKumoToastManager,
} from "@cloudflare/kumo";
import {
  ArrowDownLeftIcon,
  ArrowsDownUpIcon,
  ArrowUpRightIcon,
  BellSimpleRingingIcon,
  DotsThreeIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  PlusIcon,
  TelegramLogoIcon,
  TrashIcon,
  WebhooksLogoIcon,
} from "@phosphor-icons/react";
import { api, type AppState, type Destination, type DestinationType, type Rule } from "../api";
import { Tip } from "./Tip";
import {
  absoluteTime,
  describeAsset,
  DIRECTION_LABEL,
  humanize,
  relativeTime,
  shortAddress,
  statusTone,
  TYPE_LABEL,
  type Tone,
} from "../format";

export const TYPE_ICON: Record<DestinationType, typeof WebhooksLogoIcon> = {
  webhook: WebhooksLogoIcon,
  ntfy: BellSimpleRingingIcon,
  telegram: TelegramLogoIcon,
};

interface Props {
  state: AppState;
  onCreate: () => void;
  onEdit: (d: Destination) => void;
  onChanged: () => Promise<void>;
  onAuthLoss: (err: unknown) => boolean;
}

export function DestinationList({ state, onCreate, onEdit, onChanged, onAuthLoss }: Props) {
  const toasts = useKumoToastManager();
  const [testing, setTesting] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Destination | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function sendTest(d: Destination) {
    setTesting(d.id);
    try {
      await api.testDestination(d.id);
      toasts.add({ variant: "success", title: "Test sent", description: `Check ${d.name} for the test message.` });
    } catch (err) {
      if (!onAuthLoss(err)) {
        toasts.add({
          variant: "error",
          title: `Test to ${d.name} failed`,
          description: err instanceof Error ? err.message : "Unknown error",
        });
      }
    } finally {
      setTesting(null);
      void onChanged();
    }
  }

  function askDelete(d: Destination) {
    setDeleteTarget(d);
    setDeleteError(null);
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteDestination(deleteTarget.id);
      setDeleteOpen(false);
      toasts.add({ title: `Deleted ${deleteTarget.name}` });
      await onChanged();
    } catch (err) {
      if (!onAuthLoss(err)) setDeleteError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  }

  if (state.destinations.length === 0) {
    return (
      <LayerCard className="px-5 py-10">
        <Empty
          icon={<PaperPlaneTiltIcon size={40} />}
          title="Add your first destination"
          description="Choose a webhook, an ntfy topic or a Telegram chat, then add the wallets to watch."
          contents={
            <Button variant="primary" icon={<PlusIcon />} onClick={onCreate}>
              Add destination
            </Button>
          }
        />
      </LayerCard>
    );
  }

  const sortedDeliveries = [...state.deliveries].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return (
    <>
      <ul className="grid gap-4">
        {state.destinations.map((d) => {
          const last = sortedDeliveries.find((x) => x.destinationId === d.id);
          return (
            <li key={d.id}>
              <DestinationCard
                destination={d}
                state={state}
                lastDelivery={last ? { status: last.status, at: last.createdAt, error: last.error } : null}
                testing={testing === d.id}
                onTest={() => void sendTest(d)}
                onEdit={() => onEdit(d)}
                onDelete={() => askDelete(d)}
              />
            </li>
          );
        })}
      </ul>

      <LayerDialog.Alert open={deleteOpen} onOpenChange={(o) => !deleting && setDeleteOpen(o)} dismissDisabled={deleting}>
        <LayerDialog.Content size="sm">
          <LayerDialog.Title>Delete {deleteTarget?.name ?? "destination"}?</LayerDialog.Title>
          <LayerDialog.Description>
            Its {deleteTarget?.rules.length ?? 0} {deleteTarget?.rules.length === 1 ? "rule" : "rules"} will stop sending
            alerts.
          </LayerDialog.Description>
          <LayerDialog.Body>
            {deleteError ? (
              <Text variant="error">{deleteError}</Text>
            ) : (
              <Text variant="secondary">You can't undo this.</Text>
            )}
          </LayerDialog.Body>
          <LayerDialog.Actions dismissLabel="Cancel">
            <LayerDialog.Action variant="destructive" loading={deleting} onClick={() => void confirmDelete()}>
              Delete destination
            </LayerDialog.Action>
          </LayerDialog.Actions>
        </LayerDialog.Content>
      </LayerDialog.Alert>
    </>
  );
}

function DestinationCard({
  destination: d,
  state,
  lastDelivery,
  testing,
  onTest,
  onEdit,
  onDelete,
}: {
  destination: Destination;
  state: AppState;
  lastDelivery: { status: string; at: string; error: string | null } | null;
  testing: boolean;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const Icon = TYPE_ICON[d.type] ?? PaperPlaneTiltIcon;
  const tone = lastDelivery ? statusTone(lastDelivery.status) : null;

  return (
    <LayerCard>
      <LayerCard.Secondary className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-kumo-base text-kumo-subtle ring ring-kumo-line">
          <Icon size={18} />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <Text as="h3" variant="heading" truncate>
              {d.name}
            </Text>
            <Badge variant="neutral">{TYPE_LABEL[d.type] ?? d.type}</Badge>
          </div>
          <Text as="p" size="sm" variant="secondary" truncate>
            {configSummary(d)}
          </Text>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="secondary"
            icon={<PaperPlaneTiltIcon />}
            loading={testing}
            onClick={onTest}
            className="hidden sm:inline-flex"
          >
            Send test
          </Button>
          <Button size="sm" variant="secondary" icon={<PencilSimpleIcon />} onClick={onEdit} className="hidden sm:inline-flex">
            Edit
          </Button>
          <DropdownMenu>
            <DropdownMenu.Trigger
              render={
                <Button size="sm" variant="ghost" shape="square" aria-label={`More actions for ${d.name}`}>
                  <DotsThreeIcon size={18} weight="bold" />
                </Button>
              }
            />
            <DropdownMenu.Content align="end">
              <DropdownMenu.Item icon={PaperPlaneTiltIcon} onClick={onTest} className="sm:hidden">
                Send test
              </DropdownMenu.Item>
              <DropdownMenu.Item icon={PencilSimpleIcon} onClick={onEdit} className="sm:hidden">
                Edit
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="sm:hidden" />
              <DropdownMenu.Item icon={TrashIcon} variant="danger" onClick={onDelete}>
                Delete
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu>
        </div>
      </LayerCard.Secondary>

      <LayerCard.Primary className="grid gap-0 p-0">
        {d.rules.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Text variant="secondary">No rules yet, so nothing will be sent here.</Text>
            <Button size="sm" icon={<PlusIcon />} onClick={onEdit}>
              Add a rule
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-kumo-line">
            {d.rules.map((r, i) => (
              <RuleRow key={i} rule={r} state={state} />
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2 border-t border-kumo-line px-4 py-2.5">
          {lastDelivery ? (
            <Tip content={lastDelivery.error ?? absoluteTime(lastDelivery.at)}>
              <span className="inline-flex min-w-0 items-center gap-2">
                <Badge appearance="dot" variant={tone ?? "neutral"}>
                  {humanize(lastDelivery.status)}
                </Badge>
                <Text as="span" size="sm" variant="secondary" truncate>
                  Last delivery {relativeTime(lastDelivery.at)}
                  {lastDelivery.error ? ` · ${lastDelivery.error}` : ""}
                </Text>
              </span>
            </Tip>
          ) : (
            <Text as="span" size="sm" variant="secondary">
              No deliveries yet. Send a test to check the connection.
            </Text>
          )}
        </div>
      </LayerCard.Primary>
    </LayerCard>
  );
}

const DIRECTION_ICON = { received: ArrowDownLeftIcon, sent: ArrowUpRightIcon, both: ArrowsDownUpIcon } as const;

function RuleRow({ rule, state }: { rule: Rule; state: AppState }) {
  const nets = rule.networks.map((id) => state.networks.find((n) => n.id === id) ?? { id, name: id, family: "", symbol: "", usdt: null });
  const DirIcon = DIRECTION_ICON[rule.direction] ?? ArrowsDownUpIcon;
  const addr = rule.address;

  return (
    <li className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-4">
      <div className="grid min-w-0 content-start gap-0.5">
        <Tip content={rule.address}>
          <span className="truncate font-mono text-[13px] text-kumo-strong">{shortAddress(rule.address, 8, 6)}</span>
        </Tip>
        <span className="flex items-center gap-1 text-sm text-kumo-subtle">
          <DirIcon size={14} aria-hidden />
          {DIRECTION_LABEL[rule.direction] ?? rule.direction} · {describeAsset(rule, nets)}
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap content-start items-center gap-1.5">
        {nets.map((n) => {
          const m = state.monitors.find((x) => x.network === n.id && x.address === addr);
          const tone: Tone = !m ? "neutral" : m.error ? "error" : statusTone(m.status);
          const tip = !m
            ? `${n.name}: no monitor reported yet`
            : `${n.name}: ${humanize(m.status)}${m.error ? ` — ${m.error}` : ""}${m.updatedAt ? ` · ${relativeTime(m.updatedAt)}` : ""}`;
          return (
            <Tip key={n.id} content={tip}>
              <span>
                <Badge appearance="dot" variant={tone}>
                  {n.name}
                </Badge>
              </span>
            </Tip>
          );
        })}
      </div>
    </li>
  );
}

function configSummary(d: Destination): string {
  const c = d.config ?? {};
  const s = (k: string) => (typeof c[k] === "string" && c[k] ? (c[k] as string) : null);
  switch (d.type) {
    case "webhook":
      return s("url") ? safeHost(s("url")!) : "POSTs JSON to a saved URL";
    case "ntfy": {
      const server = s("server");
      const topic = s("topic");
      const pr = typeof c.priority === "number" ? ` · priority ${c.priority}` : "";
      const where = topic ? `${server ? safeHost(server) : "ntfy"}/${topic}` : server ? safeHost(server) : "Saved topic";
      return where + pr;
    }
    case "telegram":
      return s("chatId") ? `Chat ${s("chatId")}` : "Bot message to a saved chat";
    default:
      return "";
  }
}

function safeHost(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}
