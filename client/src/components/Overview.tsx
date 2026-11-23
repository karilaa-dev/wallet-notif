import type { ReactNode } from "react";
import { Text } from "@cloudflare/kumo";
import type { AppState } from "../api";
import { relativeTime, statusTone, type Tone } from "../format";

type View = "destinations" | "deliveries" | "monitors" | "sources";

export function Overview({ state, onNavigate }: { state: AppState; onNavigate: (v: View) => void }) {
  const ruleCount = state.destinations.reduce((n, d) => n + (d.rules?.length ?? 0), 0);
  const wallets = new Set(
    state.destinations.flatMap((d) => (d.rules ?? []).map((r) => r.address)).filter(Boolean),
  ).size;

  const monitorTones = state.monitors.map((m) => (m.error ? "error" : statusTone(m.status)));
  const monErr = monitorTones.filter((t) => t === "error").length;
  const monWarn = monitorTones.filter((t) => t === "warning").length;
  const monOk = state.monitors.length - monErr - monWarn;
  const monTone: Tone = monErr ? "error" : monWarn ? "warning" : state.monitors.length ? "success" : "neutral";

  const sorted = [...state.deliveries].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const latest = sorted[0];
  const failed = state.deliveries.filter((d) => statusTone(d.status) === "error").length;
  const delTone: Tone = latest ? statusTone(latest.status) : "neutral";

  return (
    <section aria-label="Overview" className="grid grid-cols-3 overflow-hidden rounded-xl bg-kumo-base ring ring-kumo-line">
      <Stat
        label="Destinations"
        value={state.destinations.length}
        detail={
          state.destinations.length
            ? `${ruleCount} ${ruleCount === 1 ? "rule" : "rules"} · ${wallets} ${wallets === 1 ? "wallet" : "wallets"}`
            : "None yet"
        }
        onClick={() => onNavigate("destinations")}
      />
      <Stat
        label="Monitors"
        tone={monTone}
        value={state.monitors.length ? `${monOk}/${state.monitors.length}` : 0}
        detail={
          !state.monitors.length
            ? "Start with a rule"
            : monErr
              ? `${monErr} failing`
              : monWarn
                ? `${monWarn} catching up`
                : "All healthy"
        }
        onClick={() => onNavigate("monitors")}
      />
      <Stat
        label="Last delivery"
        tone={delTone}
        value={latest ? relativeTime(latest.createdAt) : "—"}
        detail={failed ? `${failed} failed recently` : latest ? "No recent failures" : "Nothing sent yet"}
        onClick={() => onNavigate("deliveries")}
      />
    </section>
  );
}

const DOT: Record<Tone, string> = {
  success: "bg-kumo-success",
  error: "bg-kumo-danger",
  warning: "bg-kumo-warning",
  neutral: "bg-kumo-fill",
};

function Stat({
  label,
  value,
  detail,
  tone,
  onClick,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  tone?: Tone;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid min-w-0 content-start gap-1 border-l border-kumo-line px-3 py-3 text-left first:border-l-0 hover:bg-kumo-tint focus-visible:relative focus-visible:outline-2 focus-visible:outline-kumo-focus sm:px-5 sm:py-4"
    >
      <span className="flex items-center gap-1.5">
        {tone && <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[tone]}`} />}
        <Text as="span" size="sm" variant="secondary" truncate>
          {label}
        </Text>
      </span>
      <span className="truncate text-lg font-semibold tabular-nums text-kumo-strong sm:text-xl">{value}</span>
      <Text as="span" size="xs" variant="secondary" truncate>
        {detail}
      </Text>
    </button>
  );
}
