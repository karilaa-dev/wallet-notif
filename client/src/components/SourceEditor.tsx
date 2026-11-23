import { useEffect, useId, useState, type FormEvent } from "react";
import { Banner, Checkbox, LayerDialog, Radio, SensitiveInput, Text, useKumoToastManager } from "@cloudflare/kumo";
import { WarningCircleIcon } from "@phosphor-icons/react";
import { api, type NetworkSource, type SourceInput, type SourceOption } from "../api";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: NetworkSource | null;
  networkName: string;
  onSaved: () => Promise<void>;
  onAuthLoss: (err: unknown) => boolean;
}

interface Form {
  provider: string;
  apiKey: string;
  url: string;
  clearKey: boolean;
}

type FormErrors = Partial<Record<"provider" | "apiKey" | "url", string>>;

const KEY_LABEL: Record<SourceOption["key"], string> = {
  required: "API key required",
  optional: "API key optional",
  none: "No key needed",
};

function isEndpointUrl(v: string) {
  try {
    const u = new URL(v);
    return ["http:", "https:"].includes(u.protocol) && !!u.host && !u.username && !u.password && !u.search && !u.hash;
  } catch {
    return false;
  }
}

/** What the server will keep if a field is left blank. Retention only applies to the same provider and endpoint. */
function retention(source: NetworkSource, opt: SourceOption | undefined, f: Form) {
  const same = f.provider === source.provider;
  const urlKept = !!opt?.custom && same && source.hasUrl && !f.url.trim();
  const endpointSame = !opt?.custom || urlKept;
  const keyKept = !!opt && opt.key !== "none" && same && endpointSame && source.hasKey && !f.clearKey && !f.apiKey.trim();
  return { same, urlKept, keyKept, endpointSame };
}

function validateForm(source: NetworkSource, opt: SourceOption | undefined, f: Form): FormErrors {
  const e: FormErrors = {};
  if (!opt) {
    e.provider = "Choose a provider.";
    return e;
  }
  const { urlKept, keyKept } = retention(source, opt, f);
  if (opt.custom) {
    if (!f.url.trim() && !urlKept) e.url = "Enter the endpoint URL.";
    else if (f.url.trim() && !isEndpointUrl(f.url.trim())) e.url = "Enter an HTTP or HTTPS base URL without a query string or fragment.";
  }
  if (opt.key === "required" && !f.apiKey.trim() && !keyKept) e.apiKey = `Enter an API key for ${opt.name}.`;
  return e;
}

function toInput(source: NetworkSource, opt: SourceOption, f: Form): SourceInput {
  const body: SourceInput = { provider: opt.id };
  if (opt.key !== "none") {
    if (f.apiKey.trim()) body.apiKey = f.apiKey.trim();
    else if (f.clearKey && f.provider === source.provider && source.hasKey) body.apiKey = null;
  }
  if (opt.custom && f.url.trim()) body.url = f.url.trim();
  return body;
}

export function SourceEditor({ open, onOpenChange, source, networkName, onSaved, onAuthLoss }: Props) {
  const formId = useId();
  const toasts = useKumoToastManager();
  const [form, setForm] = useState<Form>({ provider: "", apiKey: "", url: "", clearKey: false });
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Reset (and drop any typed secrets) every time the dialog opens or closes.
  useEffect(() => {
    setForm({ provider: source?.provider ?? "", apiKey: "", url: "", clearKey: false });
    setSubmitted(false);
    setServerError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, source?.network]);

  if (!source) return null;

  const opt = source.options.find((o) => o.id === form.provider);
  const errors = submitted ? validateForm(source, opt, form) : {};
  const { same, urlKept, keyKept } = retention(source, opt, form);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!source) return;
    setSubmitted(true);
    const errs = validateForm(source, opt, form);
    if (Object.keys(errs).length || !opt) {
      setServerError("Fix the highlighted fields to continue.");
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      await api.updateSource(source.network, toInput(source, opt, form));
      setForm((f) => ({ ...f, apiKey: "", url: "" }));
      toasts.add({ variant: "success", title: `${networkName} now uses ${opt.name}` });
      onOpenChange(false);
      await onSaved();
    } catch (err) {
      if (!onAuthLoss(err)) setServerError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  const keyDescription = !opt
    ? undefined
    : keyKept
      ? "A key is saved and hidden. Leave blank to keep it."
      : same && source.hasKey && opt.custom && form.url.trim()
        ? "Changing the endpoint drops the saved key. Enter it again if the new endpoint needs one."
        : !same && opt.key === "optional"
          ? "Optional. Without a key, this provider may be rate-limited."
          : opt.key === "optional"
            ? "Optional. Raises rate limits with this provider."
            : undefined;

  return (
    <LayerDialog.Root open={open} onOpenChange={(o) => !saving && onOpenChange(o)} dismissDisabled={saving}>
      <LayerDialog.Content size="lg" verticalAlign="top">
        <LayerDialog.Title>{networkName} source</LayerDialog.Title>
        <LayerDialog.Description>Pick the provider monitors use to read {networkName} transactions.</LayerDialog.Description>
        <LayerDialog.Body>
          <form id={formId} className="grid gap-6" onSubmit={submit} noValidate autoComplete="off">
            {serverError && (
              <Banner variant="error" size="sm" icon={<WarningCircleIcon weight="fill" />} description={serverError} />
            )}

            <Radio.Group
              legend="Provider"
              appearance="card"
              value={form.provider}
              onValueChange={(v) => setForm((f) => ({ ...f, provider: v as string, apiKey: "", url: "", clearKey: false }))}
              error={errors.provider}
            >
              {source.options.map((o) => (
                <Radio.Item
                  key={o.id}
                  value={o.id}
                  label={
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {o.name}
                      {o.id === source.provider && (
                        <span className="rounded-full bg-kumo-fill px-1.5 text-xs text-kumo-subtle">Active</span>
                      )}
                    </span>
                  }
                  description={
                    <>
                      {o.description}
                      <span className="mt-1 block text-xs text-kumo-subtle">
                        {KEY_LABEL[o.key] ?? o.key}
                        {o.custom ? " · Custom endpoint" : ""}
                      </span>
                    </>
                  }
                />
              ))}
            </Radio.Group>

            {opt && (opt.custom || opt.key !== "none") && (
              <div className="grid gap-5">
                {opt.custom && (
                  <SensitiveInput
                    label="Endpoint URL"
                    value={form.url}
                    onValueChange={(v: string) => set("url", v)}
                    placeholder={urlKept ? "•••••••• (unchanged)" : "https://…"}
                    description={
                      urlKept
                        ? "A URL is saved and hidden. Leave blank to keep it."
                        : "Enter the indexer’s HTTP or HTTPS base URL. Saved URLs are hidden."
                    }
                    error={errors.url}
                    autoComplete="off"
                    required={false}
                  />
                )}
                {opt.key !== "none" && (
                  <SensitiveInput
                    label={opt.key === "required" ? "API key" : "API key (optional)"}
                    value={form.apiKey}
                    onValueChange={(v: string) => set("apiKey", v)}
                    disabled={form.clearKey}
                    placeholder={keyKept ? "•••••••• (unchanged)" : undefined}
                    description={keyDescription}
                    error={errors.apiKey}
                    autoComplete="off"
                    required={false}
                  />
                )}
                {opt.key === "optional" && same && source.hasKey && (
                  <Checkbox
                    label="Remove saved API key"
                    checked={form.clearKey}
                    onCheckedChange={(c) => setForm((f) => ({ ...f, clearKey: c === true, apiKey: "" }))}
                  />
                )}
              </div>
            )}

            {opt && !same && (
              <Text size="sm" variant="secondary">
                {networkName} monitors switch from{" "}
                {source.options.find((o) => o.id === source.provider)?.name ?? source.provider} to {opt.name} as soon as
                you save. Saved credentials for the current provider aren't reused.
              </Text>
            )}
          </form>
        </LayerDialog.Body>
        <LayerDialog.Actions dismissLabel="Cancel">
          <LayerDialog.Action type="submit" form={formId} loading={saving}>
            Save source
          </LayerDialog.Action>
        </LayerDialog.Actions>
      </LayerDialog.Content>
    </LayerDialog.Root>
  );
}
