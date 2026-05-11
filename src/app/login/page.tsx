"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

function AuthBrandedLoader() {
  return (
    <div className="flex flex-col items-center gap-6" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <p
        className="text-center text-2xl font-semibold tracking-tight text-(--realm-navy)"
        style={{ fontFamily: "var(--font-onest), sans-serif" }}
      >
        Realm<span className="font-semibold text-(--realm-purple)">.</span>
        <span className="font-semibold">Security</span>
      </p>
      <div className="flex items-center gap-1.5" aria-hidden>
        <span className="auth-load-dot inline-block h-2 w-2 rounded-full bg-(--realm-navy-muted)" />
        <span className="auth-load-dot auth-load-dot--2 inline-block h-2 w-2 rounded-full bg-(--realm-navy-muted)" />
        <span className="auth-load-dot auth-load-dot--3 inline-block h-2 w-2 rounded-full bg-(--realm-navy-muted)" />
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <LoginPageContent />;
}

function LoginPageContent() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Post-login destination from `?next=`; ref avoids `useSearchParams` + Suspense (extra loading phase). */
  const nextPathRef = useRef("/");
  const [sessionCheckDone, setSessionCheckDone] = useState(false);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("next") ?? "/";
    const path = raw.startsWith("/") ? raw : "/";
    nextPathRef.current = path;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/session");
        if (cancelled) return;
        if (res.ok) {
          router.replace(path);
          router.refresh();
          return;
        }
      } catch {
        /* show login */
      }
      if (!cancelled) setSessionCheckDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const showLoader = !sessionCheckDone;

  useEffect(() => {
    if (!showLoader) passwordInputRef.current?.focus();
  }, [showLoader]);

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
      router.replace(nextPathRef.current);
      router.refresh();
    } catch {
      setError("Login failed. Please try again.");
      setBusy(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-(--bg-page) px-4">
      <div
        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-500 ease-out ${
          showLoader ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden={!showLoader}
      >
        <AuthBrandedLoader />
      </div>
      <div
        className={`flex min-h-screen items-center justify-center transition-opacity duration-500 ease-out ${
          showLoader ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
        aria-hidden={showLoader}
      >
        <form
          onSubmit={submit}
          className="w-full max-w-sm rounded-xl border border-(--border-default) bg-(--bg-card) p-6 shadow-(--shadow-card)"
        >
          <h1 className="text-lg font-semibold text-(--realm-navy)">Realm Enrichment Tool</h1>
          <p className="mt-1 text-sm text-(--text-muted)">Enter password to continue.</p>
          <label className="mt-4 flex flex-col gap-1 text-sm">
            <span className="font-medium text-(--text-primary)">Password</span>
            <div className="relative">
              <input
                ref={passwordInputRef}
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-(--border-default) bg-(--bg-card) px-3 py-2 pr-10 text-(--text-primary)"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-(--text-muted) hover:text-(--text-primary)"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 3l18 18" />
                    <path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
                    <path d="M9.9 5.1A10.9 10.9 0 0 1 12 5c7 0 10 7 10 7a16.7 16.7 0 0 1-4 5.1" />
                    <path d="M6.7 6.7A16.1 16.1 0 0 0 2 12s3 7 10 7a10.8 10.8 0 0 0 2.9-.4" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </label>
          {error ? (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="mt-4 w-full rounded-lg bg-(--realm-purple) px-4 py-2 text-sm font-semibold text-white transition-transform duration-75 hover:bg-(--realm-purple-hover) active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Signing in..." : "Enter"}
          </button>
        </form>
      </div>
    </main>
  );
}
