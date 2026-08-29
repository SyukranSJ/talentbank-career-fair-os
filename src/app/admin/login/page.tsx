import { Suspense } from "react";
import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/env";
import { TalentbankMark } from "@/components/site-header";
import { SetupNotice } from "@/components/setup-notice";
import { LoginForm } from "@/components/login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  return (
    <main className="flex flex-1 items-center justify-center bg-[var(--surface-muted)] px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <TalentbankMark />
        </div>
        <div className="card p-6">
          <h1 className="text-xl font-bold text-[var(--color-ink-900)]">Events team sign in</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Manage the career fair calendar.
          </p>
          {/* LoginForm reads the `next` query parameter with useSearchParams(),
              which forces a client-side bailout during prerendering. The
              Suspense boundary is what lets the rest of this page stay static
              and the build succeed. Worth knowing this failure only appears
              once Supabase is configured — before that, the branch above
              short-circuits and the hook is never reached. */}
          <Suspense fallback={<LoginFormSkeleton />}>
            <LoginForm />
          </Suspense>
        </div>
        <p className="mt-4 text-center text-xs text-[var(--muted-foreground)]">
          <Link href="/" className="font-semibold text-[var(--color-brand-700)] hover:underline">
            Back to the public calendar
          </Link>
        </p>
      </div>
    </main>
  );
}

/** Matches the real form's height so the page does not jump as it hydrates. */
function LoginFormSkeleton() {
  return (
    <div className="mt-5 space-y-4" aria-hidden>
      <div className="h-[62px] rounded-lg bg-slate-100" />
      <div className="h-[62px] rounded-lg bg-slate-100" />
      <div className="h-[42px] rounded-lg bg-slate-200" />
    </div>
  );
}
