import Link from "next/link";

export function TalentbankMark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span
        className="grid size-8 place-items-center rounded-lg bg-[var(--color-ink-900)] text-white"
        aria-hidden
      >
        <svg viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M4 19V9l8-5 8 5v10" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9 19v-5h6v5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-bold tracking-tight text-[var(--color-ink-900)]">
          Talentbank
        </span>
        <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
          Career Fair OS
        </span>
      </span>
    </span>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="rounded-md" aria-label="Talentbank Career Fair OS, home">
          <TalentbankMark />
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            href="/"
            className="rounded-md px-3 py-2 font-medium text-[var(--foreground)] hover:bg-slate-100"
          >
            Career fairs
          </Link>
          <Link
            href="/admin"
            className="rounded-md px-3 py-2 font-medium text-[var(--muted-foreground)] hover:bg-slate-100"
          >
            Events team
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t bg-[var(--surface-muted)]">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TalentbankMark />
          <p className="max-w-md text-xs leading-relaxed text-[var(--muted-foreground)]">
            Prototype built for the Talentbank Junior AI Automation Engineer challenge.
            All events shown are <strong className="font-semibold">demonstration data</strong> and
            are not real Talentbank events.
          </p>
        </div>
      </div>
    </footer>
  );
}
