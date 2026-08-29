import { TalentbankMark } from "./site-header";

/**
 * Shown instead of a crash when the app has no Supabase credentials yet.
 * A blank white screen with a stack trace is the worst possible first-run
 * experience, so the missing-configuration case gets a real design.
 */
export function SetupNotice({ detail }: { detail?: string }) {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col justify-center px-4 py-16">
      <div className="card p-8">
        <TalentbankMark />
        <h1 className="mt-6 text-2xl font-bold text-[var(--color-ink-900)]">
          Finish connecting the database
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
          The app is running, but it has no Supabase project to read events from yet.
        </p>

        <ol className="mt-6 space-y-4 text-sm">
          <Step n={1} title="Create a Supabase project">
            Go to <Code>supabase.com/dashboard</Code> and create a new project. Any region works;
            Singapore is closest to Malaysia.
          </Step>
          <Step n={2} title="Create the database tables">
            Open the SQL Editor, paste the whole of{" "}
            <Code>supabase/setup.sql</Code>, and run it. That one file contains
            all three migrations in order.
          </Step>
          <Step n={3} title="Fill in .env.local">
            Copy the Project URL and the <Code>anon</Code> and <Code>service_role</Code> keys from
            Project Settings → API into <Code>.env.local</Code>.
          </Step>
          <Step n={4} title="Load the demo data">
            Run <Code>npm run seed</Code>, then restart <Code>npm run dev</Code>.
          </Step>
        </ol>

        {detail && (
          <p className="mt-6 rounded-lg bg-[var(--color-status-cancelled-bg)] p-3 font-mono text-xs text-[var(--color-status-cancelled)]">
            {detail}
          </p>
        )}
      </div>
    </main>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--color-ink-900)] text-xs font-bold text-white">
        {n}
      </span>
      <div>
        <p className="font-semibold text-[var(--color-ink-900)]">{title}</p>
        <p className="mt-0.5 leading-relaxed text-[var(--muted-foreground)]">{children}</p>
      </div>
    </li>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] text-[var(--color-ink-900)]">
      {children}
    </code>
  );
}
