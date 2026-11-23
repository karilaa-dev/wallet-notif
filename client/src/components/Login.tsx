import { useState, type FormEvent } from "react";
import { Banner, Button, Input, LayerCard, Text } from "@cloudflare/kumo";
import { WarningCircleIcon } from "@phosphor-icons/react";
import { api } from "../api";
import { BrandMark } from "./BrandMark";

export function Login({ onSuccess, notice }: { onSuccess: () => void; notice?: string | null }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      setPassword("");
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="grid w-full max-w-sm gap-6">
        <div className="grid justify-items-center gap-3 text-center">
          <BrandMark size={40} />
          <div className="grid gap-1">
            <Text as="h1" variant="heading" size="lg">
              Wallet alerts
            </Text>
            <Text variant="secondary">Sign in to manage where wallet activity is sent.</Text>
          </div>
        </div>
        <LayerCard className="px-5 py-5">
          <form className="grid gap-4" onSubmit={submit} noValidate>
            {notice && !error && <Banner variant="secondary" size="sm" description={notice} />}
            {error && (
              <Banner variant="error" size="sm" icon={<WarningCircleIcon weight="fill" />} description={error} />
            )}
            {/* Hidden username helps password managers associate the credential. */}
            <input type="text" name="username" autoComplete="username" value="admin" readOnly hidden />
            <Input
              label="Password"
              type="password"
              name="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
            <Button type="submit" variant="primary" loading={busy} className="w-full justify-center">
              Sign in
            </Button>
          </form>
        </LayerCard>
      </div>
    </main>
  );
}
