"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nextPath = useMemo(() => {
    const next = searchParams.get("next") ?? "/";
    if (!next.startsWith("/")) return "/";
    return next;
  }, [searchParams]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError("Incorrect password");
        setBusy(false);
        return;
      }
      router.replace(nextPath);
      router.refresh();
    } catch {
      setError("Login failed. Please try again.");
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-(--bg-page) px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-(--border-default) bg-(--bg-card) p-6 shadow-(--shadow-card)"
      >
        <h1 className="text-lg font-semibold text-(--realm-navy)">Realm Enrichment Tool</h1>
        <p className="mt-1 text-sm text-(--text-muted)">Enter password to continue.</p>
        <label className="mt-4 flex flex-col gap-1 text-sm">
          <span className="font-medium text-(--text-primary)">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-(--border-default) bg-(--bg-card) px-3 py-2 text-(--text-primary)"
            autoFocus
            required
          />
        </label>
        {error ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full rounded-lg bg-(--realm-purple) px-4 py-2 text-sm font-semibold text-white hover:bg-(--realm-purple-hover) disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Signing in..." : "Enter"}
        </button>
      </form>
    </main>
  );
}
