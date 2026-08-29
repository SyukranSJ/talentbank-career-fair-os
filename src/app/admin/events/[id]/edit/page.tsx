import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { getEventById } from "@/lib/data/events";
import { toDateKey, toTimeKey } from "@/lib/domain/time";
import { AdminShell } from "@/components/admin/admin-shell";
import { EventForm } from "@/components/admin/event-form";
import { SetupNotice } from "@/components/setup-notice";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit event" };

export default async function EditEventPage({ params }: PageProps<"/admin/events/[id]/edit">) {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const admin = await requireAdmin();
  const { id } = await params;
  const event = await getEventById(id);
  if (!event) notFound();

  const startDate = toDateKey(event.startAt);
  const endDate = toDateKey(event.endAt);

  return (
    <AdminShell admin={admin} active="/admin/events">
      <div className="mx-auto max-w-3xl">
        <Link
          href={`/admin/events/${event.id}`}
          className="text-sm font-semibold text-[var(--color-brand-700)] hover:underline"
        >
          ← Back to event
        </Link>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-[var(--color-ink-900)]">
          Edit {event.title}
        </h1>

        <div className="mt-6">
          <EventForm
            mode="edit"
            eventId={event.id}
            registeredCount={event.registeredCount}
            initial={{
              title: event.title,
              description: event.description,
              date: startDate,
              endDate: endDate === startDate ? undefined : endDate,
              startTime: toTimeKey(event.startAt),
              endTime: toTimeKey(event.endAt),
              location: event.location,
              state: event.state,
              category: event.category,
              audience: event.audience,
              capacity: event.capacity,
              status: event.status,
            }}
          />
        </div>
      </div>
    </AdminShell>
  );
}
