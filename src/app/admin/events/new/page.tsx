import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { AdminShell } from "@/components/admin/admin-shell";
import { EventForm } from "@/components/admin/event-form";
import { SetupNotice } from "@/components/setup-notice";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add event" };

export default async function NewEventPage() {
  if (!isSupabaseConfigured()) return <SetupNotice />;
  const admin = await requireAdmin();

  return (
    <AdminShell admin={admin} active="/admin/events/new">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/admin/events"
          className="text-sm font-semibold text-[var(--color-brand-700)] hover:underline"
        >
          ← All events
        </Link>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-[var(--color-ink-900)]">
          Add an event
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          The calendar is checked for clashes as you type. A clash is a warning, not a block.
        </p>

        <div className="mt-6">
          <EventForm mode="create" />
        </div>
      </div>
    </AdminShell>
  );
}
