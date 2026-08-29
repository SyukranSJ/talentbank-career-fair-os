import Link from "next/link";
import { signOut } from "@/lib/actions/auth";
import { TalentbankMark } from "@/components/site-header";
import type { AdminUser } from "@/lib/auth";

const NAV = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/events", label: "Events", exact: false },
  { href: "/admin/events/new", label: "Add event", exact: true },
] as const;

export function AdminShell({
  admin,
  active,
  children,
}: {
  admin: AdminUser;
  active: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-[var(--surface-muted)]">
      <header className="border-b bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Link href="/admin">
              <TalentbankMark />
            </Link>
            <span className="hidden rounded-md bg-[var(--color-ink-900)] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white sm:inline">
              Events team
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/"
              target="_blank"
              className="hidden rounded-md px-2.5 py-1.5 text-xs font-semibold text-[var(--muted-foreground)] hover:bg-slate-100 sm:inline-flex sm:items-center sm:gap-1.5"
            >
              View public site
              <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <div className="hidden text-right sm:block">
              <p className="text-xs font-semibold text-[var(--color-ink-900)]">{admin.fullName}</p>
              <p className="text-[11px] text-[var(--muted-foreground)]">{admin.email}</p>
            </div>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-50"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>

        <nav className="mx-auto flex max-w-7xl gap-1 px-4 sm:px-6">
          {NAV.map((item) => {
            // "Events" should not light up while you are on "Add event".
            const isActive = item.exact
              ? active === item.href
              : active.startsWith(item.href) && active !== "/admin/events/new";
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${
                  isActive
                    ? "border-[var(--color-brand-600)] text-[var(--color-brand-700)]"
                    : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
