import { useCallback, useEffect, useRef, useState } from "react";
import { Banner, Button, Loader, Tabs, Text } from "@cloudflare/kumo";
import { ArrowClockwiseIcon, PlusIcon, SignOutIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { api, ApiError, type AppState, type Destination } from "./api";
import { BrandMark } from "./components/BrandMark";
import { Tip } from "./components/Tip";
import { Login } from "./components/Login";
import { Overview } from "./components/Overview";
import { DestinationList } from "./components/DestinationList";
import { DestinationEditor } from "./components/DestinationEditor";
import { DeliveriesView } from "./components/DeliveriesView";
import { MonitorsView } from "./components/MonitorsView";
import { SourcesView, sourceHealth } from "./components/SourcesView";
import { relativeTime } from "./format";

type Phase = "checking" | "login" | "ready";
type View = "destinations" | "deliveries" | "monitors" | "sources";

const POLL_MS = 15_000;

export function App() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [state, setState] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastLoaded, setLastLoaded] = useState<string | null>(null);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [view, setView] = useState<View>("destinations");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Destination | null>(null);
  const [, tick] = useState(0);
  const inflight = useRef<Promise<void> | null>(null);

  const handleAuthLoss = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) {
      setPhase((p) => {
        if (p === "ready") setLoginNotice("Your session ended. Sign in again to continue.");
        return "login";
      });
      setState(null);
      setEditorOpen(false);
      return true;
    }
    return false;
  }, []);

  const refresh = useCallback(async () => {
    if (inflight.current) return inflight.current;
    const run = (async () => {
      setRefreshing(true);
      try {
        const s = await api.state();
        setState({
          networks: s.networks ?? [],
          destinations: s.destinations ?? [],
          deliveries: s.deliveries ?? [],
          monitors: s.monitors ?? [],
          sources: Array.isArray(s.sources)
            ? s.sources.filter((x) => x && typeof x.network === "string").map((x) => ({ ...x, options: Array.isArray(x.options) ? x.options : [] }))
            : [],
        });
        setLoadError(null);
        setLastLoaded(new Date().toISOString());
        setPhase("ready");
      } catch (err) {
        if (!handleAuthLoss(err)) {
          setLoadError(err instanceof Error ? err.message : "Couldn't load data.");
          setPhase((p) => (p === "checking" ? "ready" : p));
        }
      } finally {
        setRefreshing(false);
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, [handleAuthLoss]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll while signed in and the tab is visible; refresh on return to the tab.
  useEffect(() => {
    if (phase !== "ready") return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
      tick((n) => n + 1);
    }, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [phase, refresh]);

  async function signOut() {
    try {
      await api.logout();
    } catch {
      setLoadError("Sign-out failed. Check your connection and try again.");
      return;
    }
    await inflight.current;
    setEditorOpen(false);
    setEditing(null);
    setState(null);
    setLoginNotice(null);
    setPhase("login");
  }

  function openCreate() {
    setEditing(null);
    setEditorOpen(true);
  }
  function openEdit(d: Destination) {
    setEditing(d);
    setEditorOpen(true);
  }

  if (phase === "checking") {
    return (
      <main className="flex min-h-dvh items-center justify-center" aria-busy="true">
        <Loader size="lg" />
      </main>
    );
  }

  if (phase === "login") {
    return (
      <Login
        notice={loginNotice}
        onSuccess={() => {
          setLoginNotice(null);
          setPhase("checking");
          void refresh();
        }}
      />
    );
  }

  const failedDeliveries = state?.deliveries.filter((d) => /(fail|error)/i.test(d.status)).length ?? 0;
  const unconfiguredSources = state?.sources.filter((s) => sourceHealth(s) !== "ok" && state.monitors.some((m) => m.network === s.network)).length ?? 0;
  const troubledMonitors = state?.monitors.filter((m) => m.error || /(fail|error|down)/i.test(m.status)).length ?? 0;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-kumo-line bg-kumo-base/90 backdrop-blur supports-[backdrop-filter]:bg-kumo-base/80">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <BrandMark />
          <Text as="span" variant="heading">
            Wallet alerts
          </Text>
          <div className="ml-auto flex items-center gap-1">
            <Tip content={lastLoaded ? `Updated ${relativeTime(lastLoaded)}` : "Refresh"}>
              <Button
                variant="ghost"
                shape="square"
                aria-label="Refresh"
                onClick={() => void refresh()}
                icon={<ArrowClockwiseIcon className={refreshing ? "animate-spin" : undefined} />}
              />
            </Tip>
            <Button variant="ghost" icon={<SignOutIcon />} onClick={() => void signOut()}>
              <span className="hidden sm:inline">Sign out</span>
              <span className="sr-only sm:hidden">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl grid-cols-1 gap-6 px-4 pt-6 pb-16 sm:px-6">
        {loadError && (
          <Banner
            variant="error"
            icon={<WarningCircleIcon weight="fill" />}
            title="Couldn't refresh"
            description={state ? `${loadError} Showing the last loaded data.` : loadError}
            action={
              <Banner.Action onClick={() => void refresh()} loading={refreshing}>
                Retry
              </Banner.Action>
            }
          />
        )}

        {state && (
          <>
            <Overview state={state} onNavigate={setView} />

            <div className="grid grid-cols-1 gap-4">
              <div className="flex items-end justify-between gap-3 border-b border-kumo-line">
                <Tabs
                  variant="underline"
                  value={view}
                  onValueChange={(v) => setView(v as View)}
                  className="-mb-px min-w-0 overflow-x-auto"
                  tabs={[
                    { value: "destinations", label: <TabLabel text="Destinations" count={state.destinations.length} /> },
                    {
                      value: "deliveries",
                      label: <TabLabel text="Deliveries" count={failedDeliveries} alert={failedDeliveries > 0} />,
                    },
                    {
                      value: "monitors",
                      label: <TabLabel text="Monitors" count={troubledMonitors} alert={troubledMonitors > 0} />,
                    },
                    {
                      value: "sources",
                      label: <TabLabel text="Sources" count={unconfiguredSources} alert={unconfiguredSources > 0} />,
                    },
                  ]}
                />
                {view === "destinations" && state.destinations.length > 0 && (
                  <Button variant="primary" icon={<PlusIcon />} onClick={openCreate} className="mb-2 hidden sm:inline-flex">
                    Add destination
                  </Button>
                )}
              </div>

              {view === "destinations" && state.destinations.length > 0 && (
                <Button variant="primary" icon={<PlusIcon />} onClick={openCreate} className="w-full justify-center sm:hidden">
                  Add destination
                </Button>
              )}
              {view === "destinations" && (
                <DestinationList
                  state={state}
                  onCreate={openCreate}
                  onEdit={openEdit}
                  onChanged={refresh}
                  onAuthLoss={handleAuthLoss}
                />
              )}
              {view === "deliveries" && <DeliveriesView deliveries={state.deliveries} destinations={state.destinations} />}
              {view === "monitors" && <MonitorsView monitors={state.monitors} networks={state.networks} />}
              {view === "sources" && (
                <SourcesView
                  sources={state.sources}
                  networks={state.networks}
                  onChanged={refresh}
                  onAuthLoss={handleAuthLoss}
                />
              )}
            </div>
          </>
        )}
      </main>

      <DestinationEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        destination={editing}
        networks={state?.networks ?? []}
        onSaved={refresh}
        onAuthLoss={handleAuthLoss}
      />
    </div>
  );
}

function TabLabel({ text, count, alert }: { text: string; count: number; alert?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {text}
      {count > 0 && (
        <span
          className={
            "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs tabular-nums " +
            (alert ? "bg-kumo-danger-tint text-kumo-danger" : "bg-kumo-fill text-kumo-subtle")
          }
        >
          {count}
        </span>
      )}
    </span>
  );
}
