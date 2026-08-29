import type { EventStatus } from "@/lib/domain/types";
import { STATUS_LABELS } from "@/lib/domain/types";

/**
 * Status is the most important thing on the page. A visitor planning their week
 * needs to know in one glance whether a fair is still open, so every status has
 * its own colour AND its own words — colour alone would fail anyone who cannot
 * distinguish it.
 */

const STYLES: Record<EventStatus, string> = {
  UPCOMING:
    "bg-[var(--color-status-open-bg)] text-[var(--color-status-open)] ring-[var(--color-status-open-line)]",
  FULL: "bg-[var(--color-status-full-bg)] text-[var(--color-status-full)] ring-[var(--color-status-full-line)]",
  CANCELLED:
    "bg-[var(--color-status-cancelled-bg)] text-[var(--color-status-cancelled)] ring-[var(--color-status-cancelled-line)]",
  COMPLETED:
    "bg-[var(--color-status-done-bg)] text-[var(--color-status-done)] ring-[var(--color-status-done-line)]",
  RESCHEDULED:
    "bg-[var(--color-status-moved-bg)] text-[var(--color-status-moved)] ring-[var(--color-status-moved-line)]",
};

const DOTS: Record<EventStatus, string> = {
  UPCOMING: "bg-[var(--color-status-open)]",
  FULL: "bg-[var(--color-status-full)]",
  CANCELLED: "bg-[var(--color-status-cancelled)]",
  COMPLETED: "bg-[var(--color-status-done)]",
  RESCHEDULED: "bg-[var(--color-status-moved)]",
};

export function StatusBadge({
  status,
  size = "md",
}: {
  status: EventStatus;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold uppercase tracking-wide ring-1 ring-inset ${pad} ${STYLES[status]}`}
    >
      <span className={`size-1.5 rounded-full ${DOTS[status]}`} aria-hidden />
      {STATUS_LABELS[status]}
    </span>
  );
}
