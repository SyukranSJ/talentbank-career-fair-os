import type { Availability } from "@/lib/domain/availability";

/**
 * Capacity, phrased the way someone deciding whether to attend thinks about it:
 * "how many places are left", not "83/100". The bar is secondary information.
 */
export function CapacityMeter({
  availability,
  showBar = true,
  compact = false,
}: {
  availability: Availability;
  showBar?: boolean;
  compact?: boolean;
}) {
  const { registered, capacity, remaining, percentFull, isAtCapacity, isAlmostFull } = availability;

  const tone = isAtCapacity
    ? "text-[var(--color-status-full)]"
    : isAlmostFull
      ? "text-[var(--color-status-full)]"
      : "text-[var(--muted-foreground)]";

  const barColour = isAtCapacity
    ? "bg-[var(--color-status-full)]"
    : isAlmostFull
      ? "bg-amber-500"
      : "bg-[var(--color-brand-600)]";

  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className={`font-medium ${tone}`}>
          {isAtCapacity
            ? "No places left"
            : `${remaining.toLocaleString()} ${remaining === 1 ? "place" : "places"} left`}
        </span>
        <span className="tabular-nums text-[var(--muted-foreground)]">
          {registered.toLocaleString()} / {capacity.toLocaleString()}
        </span>
      </div>
      {showBar && (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-valuenow={percentFull}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${registered} of ${capacity} places taken`}
        >
          <div className={`h-full rounded-full ${barColour}`} style={{ width: `${percentFull}%` }} />
        </div>
      )}
    </div>
  );
}
