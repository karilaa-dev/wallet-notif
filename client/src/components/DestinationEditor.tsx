import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Banner, Button, Input, LayerDialog, Radio, SensitiveInput, Text, useKumoToastManager } from "@cloudflare/kumo";
import { PlusIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { api, type Destination, type DestinationType, type Network } from "../api";
import {
  destinationToDraft,
  emptyRule,
  hiddenFields,
  toPayload,
  validate,
  type ConfigField,
  type Draft,
  type Errors,
  type RuleDraft,
} from "./draft";
import { RuleEditor } from "./RuleEditor";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destination: Destination | null;
  networks: Network[];
  onSaved: () => Promise<void>;
  onAuthLoss: (err: unknown) => boolean;
}

const PRIORITIES: [string, string][] = [
  ["1", "Min"],
  ["2", "Low"],
  ["3", "Default"],
  ["4", "High"],
  ["5", "Urgent"],
];

export function DestinationEditor({ open, onOpenChange, destination, networks, onSaved, onAuthLoss }: Props) {
  const formId = useId();
  const toasts = useKumoToastManager();
  const [draft, setDraft] = useState<Draft>(() => destinationToDraft(null));
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Reset the form each time the editor opens.
  useEffect(() => {
    if (!open) return;
    setDraft(destinationToDraft(destination));
    setErrors({});
    setSubmitted(false);
    setServerError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, destination]);

  const isEdit = destination !== null;
  const hidden = useMemo(() => hiddenFields(destination, draft.type), [destination, draft.type]);

  // After the first submit attempt, keep errors live as the user fixes them.
  useEffect(() => {
    if (submitted) setErrors(validate(draft, hidden, networks));
  }, [draft, submitted, hidden, networks]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const patchRule = (key: string, patch: Partial<RuleDraft>) =>
    setDraft((d) => ({ ...d, rules: d.rules.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    const errs = validate(draft, hidden, networks);
    setErrors(errs);
    if (Object.keys(errs).length) {
      setServerError("Fix the highlighted fields to continue.");
      // Bring the first problem into view (the sheet can be long on mobile).
      requestAnimationFrame(() => {
        const form = document.getElementById(formId);
        const bad = form?.querySelector<HTMLElement>('[aria-invalid="true"]');
        if (bad) bad.focus({ preventScroll: false });
        else form?.scrollIntoView({ block: "start" });
      });
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      const payload = toPayload(draft);
      if (destination) await api.updateDestination(destination.id, payload);
      else await api.createDestination(payload);
      toasts.add({ variant: "success", title: destination ? "Changes saved" : `${payload.name} created` });
      onOpenChange(false);
      await onSaved();
    } catch (err) {
      if (!onAuthLoss(err)) setServerError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  const keepHint = (f: ConfigField, what: string) =>
    hidden.has(f) ? `Saved and hidden. Leave blank to keep the current ${what}.` : undefined;
  const keepPlaceholder = (f: ConfigField, fallback: string) => (hidden.has(f) ? "•••••••• (unchanged)" : fallback);

  return (
    <LayerDialog.Root open={open} onOpenChange={(o) => !saving && onOpenChange(o)} dismissDisabled={saving}>
      <LayerDialog.Content size="lg" verticalAlign="top">
        <LayerDialog.Title>{isEdit ? `Edit ${destination.name}` : "Add destination"}</LayerDialog.Title>
        <LayerDialog.Description>
          Choose where alerts go, then add rules for each wallet you want to watch.
        </LayerDialog.Description>
        <LayerDialog.Body>
          <form id={formId} className="grid gap-8" onSubmit={submit} noValidate>
            {serverError && (
              <Banner variant="error" size="sm" icon={<WarningCircleIcon weight="fill" />} description={serverError} />
            )}

            <section className="grid gap-5" aria-labelledby={`${formId}-dest`}>
              <Text as="h3" variant="heading" id={`${formId}-dest`}>
                Destination
              </Text>
              <Input
                label="Name"
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="e.g. Treasury alerts"
                error={errors.name}
                autoComplete="off"
                passwordManagerIgnore
              />

              <Radio.Group
                legend="Send with"
                appearance="segmented"
                orientation="horizontal"
                value={draft.type}
                onValueChange={(v) => set("type", v as DestinationType)}
                description={
                  isEdit && destination.type !== draft.type
                    ? "Switching type replaces the saved delivery settings."
                    : undefined
                }
              >
                <Radio.Item label="ntfy" value="ntfy" />
                <Radio.Item label="Telegram" value="telegram" />
                <Radio.Item label="Webhook" value="webhook" />
              </Radio.Group>

              {draft.type === "webhook" && (
                <Input
                  label="Webhook URL"
                  type="url"
                  inputMode="url"
                  value={draft.url}
                  onChange={(e) => set("url", e.target.value)}
                  placeholder={keepPlaceholder("url", "https://example.com/hooks/wallet")}
                  description={keepHint("url", "URL") ?? "Each alert is sent as a JSON POST."}
                  error={errors.url}
                  autoComplete="off"
                  spellCheck={false}
                  passwordManagerIgnore
                />
              )}

              {draft.type === "ntfy" && (
                <>
                  <div className="grid items-start gap-5 sm:grid-cols-2">
                    <Input
                      label="Server"
                      type="url"
                      inputMode="url"
                      value={draft.server}
                      onChange={(e) => set("server", e.target.value)}
                      error={errors.server}
                      autoComplete="off"
                      spellCheck={false}
                      passwordManagerIgnore
                    />
                    <Input
                      label="Topic"
                      value={draft.topic}
                      onChange={(e) => set("topic", e.target.value)}
                      placeholder={keepPlaceholder("topic", "my-wallet-alerts")}
                      description={keepHint("topic", "topic")}
                      error={errors.topic}
                      autoComplete="off"
                      spellCheck={false}
                      autoCapitalize="off"
                      passwordManagerIgnore
                    />
                  </div>
                  <Radio.Group
                    legend="Priority"
                    appearance="segmented"
                    orientation="horizontal"
                    value={String(draft.priority)}
                    onValueChange={(v) => set("priority", Number(v))}
                  >
                    {PRIORITIES.map(([v, label]) => (
                      <Radio.Item key={v} label={label} value={v} />
                    ))}
                  </Radio.Group>
                  <SensitiveInput
                    disabled={draft.clearToken}
                    label="Access token"
                    value={draft.token}
                    onValueChange={(v: string) => set("token", v)}
                    placeholder={keepPlaceholder("token", "tk_…")}
                    description={
                      hidden.has("token")
                        ? "Leave blank to keep the current token, if one is set."
                        : "Only needed for protected topics."
                    }
                    required={false}
                    autoComplete="off"
                  />
                  {hidden.has("token") && (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={draft.clearToken} onChange={(e) => set("clearToken", e.target.checked)} />
                      Remove saved access token
                    </label>
                  )}
                </>
              )}

              {draft.type === "telegram" && (
                <div className="grid items-start gap-5 sm:grid-cols-2">
                  <SensitiveInput
                    label="Bot token"
                    value={draft.botToken}
                    onValueChange={(v: string) => set("botToken", v)}
                    placeholder={keepPlaceholder("botToken", "123456789:AA…")}
                    description={keepHint("botToken", "token") ?? "From @BotFather."}
                    error={errors.botToken}
                    autoComplete="off"
                  />
                  <Input
                    label="Chat ID"
                    value={draft.chatId}
                    onChange={(e) => set("chatId", e.target.value)}
                    placeholder={keepPlaceholder("chatId", "-1001234567890 or @channel")}
                    description={keepHint("chatId", "chat ID") ?? "Add the bot to the chat first."}
                    error={errors.chatId}
                    autoComplete="off"
                    spellCheck={false}
                    passwordManagerIgnore
                  />
                </div>
              )}
            </section>

            <section className="grid gap-4" aria-labelledby={`${formId}-rules`}>
              <div className="grid gap-1">
                <Text as="h3" variant="heading" id={`${formId}-rules`}>
                  Rules
                </Text>
                <Text variant="secondary">An alert is sent when any rule matches a transfer.</Text>
              </div>
              {draft.rules.length === 0 && (
                <Text variant="secondary">No rules. This destination will only receive test messages.</Text>
              )}
              {draft.rules.map((r, i) => (
                <RuleEditor
                  key={r.key}
                  index={i}
                  rule={r}
                  networks={networks}
                  errors={errors}
                  canRemove
                  onChange={(p) => patchRule(r.key, p)}
                  onRemove={() => setDraft((d) => ({ ...d, rules: d.rules.filter((x) => x.key !== r.key) }))}
                  onAuthLoss={onAuthLoss}
                />
              ))}
              <div>
                <Button
                  type="button"
                  icon={<PlusIcon />}
                  onClick={() => setDraft((d) => ({ ...d, rules: [...d.rules, emptyRule()] }))}
                >
                  Add rule
                </Button>
              </div>
            </section>
          </form>
        </LayerDialog.Body>
        <LayerDialog.Actions dismissLabel="Cancel">
          <LayerDialog.Action type="submit" form={formId} loading={saving}>
            {isEdit ? "Save changes" : "Create destination"}
          </LayerDialog.Action>
        </LayerDialog.Actions>
      </LayerDialog.Content>
    </LayerDialog.Root>
  );
}
