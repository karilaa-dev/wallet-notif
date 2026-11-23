import { useEffect, useRef, useState } from "react";
import { Button, Input, Loader, Text } from "@cloudflare/kumo";
import { CheckCircleIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { api, type CatalogToken, type Network } from "../api";
import { addressHint, shortAddress } from "../format";

interface Props {
  /** Networks selected on the rule, in display order. */
  selected: Network[];
  family: string | null;
  token: CatalogToken | null;
  notice: string | null;
  /** Prefill for the search box, e.g. the symbol of a dropped match. */
  hint: string;
  error?: string;
  onPick: (token: CatalogToken | null) => void;
  onAuthLoss: (err: unknown) => boolean;
}

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "done"; tokens: CatalogToken[]; stale: boolean; source: string };

const DEBOUNCE_MS = 300;

/** Look up a token in the server's catalog and pick one with an exact contract on every selected network. */
export function TokenPicker({ selected, family, token, notice, hint, error, onPick, onAuthLoss }: Props) {
  const [query, setQuery] = useState(() => (token ? "" : hint));
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const seq = useRef(0);
  // A dropped match (networks changed) re-seeds the search with its symbol.
  useEffect(() => {
    if (hint) setQuery(hint);
  }, [hint]);
  const ids = selected.map((n) => n.id);
  const idsKey = ids.join(",");

  useEffect(() => {
    const q = query.trim();
    const mine = ++seq.current;
    if (!q || ids.length === 0) {
      setStatus({ kind: "idle" });
      return;
    }
    setStatus({ kind: "loading" });
    const t = window.setTimeout(() => {
      api
        .searchTokens(ids, q)
        .then((res) => {
          if (mine !== seq.current) return;
          // Only offer tokens with a well-formed contract on every selected network.
          const tokens = res.tokens.filter((tk) => ids.every((id) => tk.contracts[id] && !addressHint(tk.contracts[id], family)));
          setStatus({ kind: "done", tokens, stale: res.stale, source: res.source });
        })
        .catch((err) => {
          if (mine !== seq.current) return;
          if (onAuthLoss(err)) return;
          setStatus({ kind: "error", message: err instanceof Error ? err.message : "Token lookup failed." });
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, idsKey, family]);

  if (selected.length === 0) {
    return (
      <Text size="sm" variant="secondary">
        Pick networks first, then search the token catalog.
      </Text>
    );
  }

  if (token) {
    return (
      <div className="grid gap-2 rounded-lg p-3 ring ring-kumo-line">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <CheckCircleIcon weight="fill" className="shrink-0 text-kumo-success" aria-hidden />
            <Text as="span" bold truncate>
              {token.symbol}
            </Text>
            {token.name && (
              <Text as="span" size="sm" variant="secondary" truncate>
                {token.name}
              </Text>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            icon={<XIcon />}
            onClick={() => {
              setQuery(token.symbol);
              onPick(null);
            }}
          >
            Change
          </Button>
        </div>
        <ContractList token={token} selected={selected} />
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {notice && (
        <Text size="sm" variant="error">
          {notice}
        </Text>
      )}
      <Input
        label="Search token catalog"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Name or symbol, e.g. USDC"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        passwordManagerIgnore
        error={error}
        description={`Only tokens with a known contract on ${selected.map((n) => n.name).join(", ")} are shown.`}
      />
      <TokenResults status={status} selected={selected} onPick={onPick} />
    </div>
  );
}

function TokenResults({ status, selected, onPick }: { status: Status; selected: Network[]; onPick: (t: CatalogToken) => void }) {
  if (status.kind === "idle") return null;
  if (status.kind === "loading") {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-kumo-subtle" aria-live="polite">
        <Loader size="sm" /> Searching…
      </div>
    );
  }
  if (status.kind === "error") {
    return (
      <Text size="sm" variant="error">
        <WarningCircleIcon className="mr-1 inline" aria-hidden />
        {status.message}
      </Text>
    );
  }
  return (
    <div className="grid gap-2" aria-live="polite">
      {status.stale && (
        <Text size="sm" variant="secondary">
          The token list may be out of date{status.source ? ` (from ${status.source})` : ""}. Double-check the contracts.
        </Text>
      )}
      {status.tokens.length === 0 ? (
        <Text size="sm" variant="secondary">
          No catalog token matches on all selected networks. Try another name, fewer networks, or enter a contract address.
        </Text>
      ) : (
        <ul className="grid max-h-80 divide-y divide-kumo-line overflow-y-auto rounded-lg ring ring-kumo-line">
          {status.tokens.slice(0, 25).map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="grid w-full gap-1 px-3 py-2 text-left hover:bg-kumo-tint focus-visible:bg-kumo-tint focus-visible:outline-none"
                onClick={() => onPick(t)}
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 font-semibold">{t.symbol}</span>
                  <span className="truncate text-sm text-kumo-subtle">{t.name}</span>
                </span>
                <ContractList token={t} selected={selected} compact />
              </button>
            </li>
          ))}
        </ul>
      )}
      {status.tokens.length > 0 && !status.stale && status.source && (
        <Text size="xs" variant="secondary">
          Contract data from {status.source}
        </Text>
      )}
    </div>
  );
}

function ContractList({ token, selected, compact }: { token: CatalogToken; selected: Network[]; compact?: boolean }) {
  return (
    <ul className="grid gap-0.5">
      {selected.map((n) => {
        const c = token.contracts[n.id];
        return (
          <li key={n.id} className="flex min-w-0 items-baseline gap-2 text-sm">
            <span className="shrink-0 text-kumo-subtle">{n.name}</span>
            <span className="truncate font-mono text-[0.9em]" title={c}>
              {c ? (compact ? shortAddress(c, 10, 8) : c) : "—"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
