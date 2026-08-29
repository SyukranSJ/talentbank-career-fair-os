import Link from "next/link";
import type { EventWithAvailability } from "@/lib/domain/types";
import { AUDIENCE_LABELS, CATEGORY_LABELS } from "@/lib/domain/types";
import { deriveStatus, getAvailability } from "@/lib/domain/availability";
import {
  formatDailyHours,
  formatDayRange,
  relativeDayLabel,
  toDateKey,
} from "@/lib/domain/time";
import { StatusBadge } from "./status-badge";
import { CapacityMeter } from "./capacity-meter";

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" />
    </svg>
  );
}

export function EventCard({
  event,
  now,
  today,
}: {
  event: EventWithAvailability;
  now: Date;
  today: string;
}) {
  const status = deriveStatus(event, now);
  const availability = getAvailability(event);
  const isClosed = status === "CANCELLED" || status === "COMPLETED";
  const dateKey = toDateKey(event.startAt);
  // Null for anything too far out for "in N weeks" to mean anything.
  const relative = relativeDayLabel(dateKey, today);

  return (
    <Link
      href={`/events/${event.slug}`}
      className={`card group flex flex-col gap-3 p-4 transition-shadow hover:shadow-[0_2px_16px_rgba(10,31,66,0.08)] ${
        isClosed ? "opacity-75" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-brand-700)]">
            {CATEGORY_LABELS[event.category]}
          </p>
          <h3
            className={`mt-1 text-base font-semibold leading-snug text-[var(--color-ink-900)] group-hover:text-[var(--color-brand-700)] ${
              status === "CANCELLED" ? "line-through decoration-[var(--color-status-cancelled)]/50" : ""
            }`}
          >
            {event.title}
          </h3>
        </div>
        <StatusBadge status={status} size="sm" />
      </div>

      <div className="space-y-1.5 text-sm text-[var(--muted-foreground)]">
        <p className="flex items-center gap-1.5 font-medium text-[var(--foreground)]">
          {formatDayRange(dateKey, event.lastDate)}
          {!isClosed && relative && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-[var(--muted-foreground)]">
              {relative}
            </span>
          )}
        </p>
        <p className="flex items-center gap-1.5">
          <ClockIcon />
          {formatDailyHours(event.startAt, event.endAt, event.lastDate)}
        </p>
        <p className="flex items-center gap-1.5">
          <PinIcon />
          <span className="truncate">
            {event.location}, {event.state}
          </span>
        </p>
      </div>

      {status === "CANCELLED" ? (
        <p className="rounded-md bg-[var(--color-status-cancelled-bg)] px-2.5 py-2 text-xs font-medium text-[var(--color-status-cancelled)]">
          {event.cancellationReason ?? "This event has been cancelled."}
        </p>
      ) : (
        <div className="mt-auto space-y-2 border-t pt-3">
          {/* A finished event has no places to offer, so it reports turnout
              rather than availability. */}
          {status === "COMPLETED" ? (
            <p className="text-xs font-medium text-[var(--muted-foreground)]">
              {availability.registered.toLocaleString()} people registered
            </p>
          ) : (
            <CapacityMeter availability={availability} compact />
          )}
          <p className="text-[11px] font-medium text-[var(--muted-foreground)]">
            {AUDIENCE_LABELS[event.audience]}
          </p>
        </div>
      )}
    </Link>
  );
}
