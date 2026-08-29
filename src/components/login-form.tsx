"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Sign-in runs in the browser so that Supabase Auth sets its session cookie
 * directly. Everything AFTER sign-in is server-side; the browser never holds
 * anything more privileged than a normal user session.
 */
export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/admin";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError("That email and password combination was not recognised.");
      setPending(false);
      return;
    }

    // Full refresh so middleware and server components pick up the new cookie.
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-[var(--color-status-cancelled-bg)] px-3 py-2 text-sm font-medium text-[var(--color-status-cancelled)]"
        >
          {error}
        </p>
      )}

      <div>
        <label htmlFor="email" className="block text-sm font-semibold text-[var(--color-ink-900)]">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1.5 w-full rounded-lg border bg-white px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-semibold text-[var(--color-ink-900)]">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1.5 w-full rounded-lg border bg-white px-3 py-2 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-[var(--color-ink-900)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--color-ink-800)] disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
