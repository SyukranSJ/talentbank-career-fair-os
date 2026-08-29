import type { Conflict, ConflictSeverity } from "@/lib/domain/conflicts";
import { formatDailyHours, formatDayRange, toDateKey } from "@/lib/domain/time";

const SEVERITY_STYLE: Record<ConflictSeverity, { chip: string; label: string }> = {
  HIGH: {
    chip: "bg-[var(--color-status-cancelled-bg)] text-[var(--color-status-cancelled)] ring-[var(--color-status-cancelled-line)]",
    label: "Venue clash",
  },
  MEDIUM: {
    chip: "bg-[var(--color-status-full-bg)] text-[var(--color-status-full)] ring-[var(--color-status-full-line)]",
    label: "Same state",
  },
  LOW: {
    chip: "bg-slate-100 text-slate-600 ring-slate-200",
    label: "Worth a look",
  },
};

/**
 * Conflicts are shown, never enforced. The admin sees exactly what overlaps and
 * how badly, then decides. Talentbank legitimately runs several fairs on one
 * day, so a tool that refuses to save would just get worked around.
 */
export function ConflictList({ conflicts }: { conflicts: Conflict[] }) {
  if (conflicts.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--color-status-full-line)] bg-[var(--color-status-full-bg)] p-3">
      <p className="flex items-center gap-2 text-sm font-bold text-[var(--color-status-full)]">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M12 3 2.5 20h19L12 3Z" strokeLinejoin="round" />
          <path d="M12 10v4M12 17v.01" strokeLinecap="round" />
        </svg>
        {conflicts.length === 1
          ? "Potential scheduling conflict"
          : `${conflicts.length} potential scheduling conflicts`}
      </p>

      <ul className="mt-2.5 space-y-2">
        {conflicts.map((conflict) => (
          <li key={conflict.eventId} className="rounded-md bg-white/70 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${SEVERITY_STYLE[conflict.severity].chip}`}
              >
                {SEVERITY_STYLE[conflict.severity].label}
              </span>
              <span className="text-sm font-semibold text-[var(--color-ink-900)]">
                {conflict.title}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              {formatDayRange(toDateKey(conflict.startAt), conflict.lastDate)} ·{" "}
              {formatDailyHours(conflict.startAt, conflict.endAt, conflict.lastDate)} ·{" "}
              {conflict.location}
            </p>
            <p className="mt-1 text-xs text-[var(--foreground)]">{conflict.message}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WarningList({ warnings }: { warnings: { field: string; message: string }[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {warnings.map((warning, i) => (
        <li
          key={i}
          className="rounded-md bg-slate-100 px-2.5 py-2 text-xs text-[var(--muted-foreground)]"
        >
          {warning.message}
        </li>
      ))}
    </ul>
  );
}
