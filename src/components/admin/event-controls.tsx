"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  checkEventProposal,
  rescheduleEvent,
  setEventStatus,
  type ProposalCheck,
} from "@/lib/actions/events";
import { allowedTransitions } from "@/lib/domain/availability";
import { formatDateLong, formatTime12h, weekdayName } from "@/lib/domain/time";
import { STATUS_LABELS, type EventStatus } from "@/lib/domain/types";
import { ConflictList, WarningList } from "./conflict-list";

/* ========================================================================== *
 * Move / reschedule
 *
 * Shown as a before-and-after, because "18 September, 10 AM – 5 PM" next to
 * "24 September, 10 AM – 5 PM" is instantly checkable by a human, and a form
 * full of pre-filled inputs is not.
 * ========================================================================== */

export function MovePanel({
  eventId,
  current,
  location,
  state,
}: {
  eventId: string;
  current: { date: string; endDate: string | null; startTime: string; endTime: string };
  /** The event's real venue and state. Required: conflict severity is graded by
   *  venue and state, so a preview that guessed them would show the wrong
   *  severity — a same-venue clash would appear as a harmless one. */
  location: string;
  state: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(current.date);
  const [endDate, setEndDate] = useState(current.endDate);
  const [startTime, setStartTime] = useState(current.startTime);
  const [endTime, setEndTime] = useState(current.endTime);
  const [check, setCheck] = useState<ProposalCheck | null>(null);
  const [pendingConflicts, setPendingConflicts] = useState<ProposalCheck["conflicts"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  const changed =
    date !== current.date ||
    endDate !== current.endDate ||
    startTime !== current.startTime ||
    endTime !== current.endTime;

  async function checkSlot() {
    // A dry run needs a complete event shape. Only the schedule fields are
    // changing, so the rest are the event's real values — in particular the
    // venue and state, which decide how severe a clash is.
    return checkEventProposal(
      {
        title: "Moved event",
        description: "",
        date,
        endDate: endDate ?? undefined,
        startTime,
        endTime,
        location,
        state,
        category: "PUBLIC_CAREER_FAIR",
        audience: "EVERYONE",
        capacity: 1,
        status: "UPCOMING",
      },
      eventId,
    );
  }

  useEffect(() => {
    // Debounced dry run. Clearing a stale result also happens inside the
    // timeout so nothing calls setState synchronously from the effect body.
    const handle = setTimeout(async () => {
      if (!open || !changed) {
        setCheck(null);
        return;
      }
      // Same reasoning as the event form: a dry run that fails should quietly
      // disappear, not surface as an unhandled rejection in the console.
      try {
        setCheck(await checkSlot());
      } catch {
        setCheck(null);
      }
    }, 400);

    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, changed, date, endDate, startTime, endTime]);

  function move(acknowledgeConflicts: boolean) {
    setError(null);
    startSaving(async () => {
      let result;
      try {
        result = await rescheduleEvent(
          eventId,
          { date, endDate: endDate ?? undefined, startTime, endTime },
          { acknowledgeConflicts, reason: "Moved from the admin dashboard" },
        );
      } catch {
        setError("Could not reach the server. Check your connection and try again.");
        return;
      }
      if (result.ok) {
        setOpen(false);
        setPendingConflicts([]);
        router.refresh();
        return;
      }
      if (result.conflicts?.length) {
        setPendingConflicts(result.conflicts);
        return;
      }
      setError(
        result.message ?? result.errors?.map((e) => e.message).join(" ") ?? "Could not move this event.",
      );
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50"
      >
        Move event
      </button>
    );
  }

  return (
    <div className="card w-full p-5">
      <h3 className="text-base font-bold text-[var(--color-ink-900)]">Move this event</h3>
      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
        Everyone already registered keeps their place, and the public page will show that the event
        has moved.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
            Currently
          </p>
          <p className="mt-1 text-sm font-semibold text-[var(--color-ink-900)]">
            {formatDateLong(current.date)}
            {current.endDate && ` – ${formatDateLong(current.endDate)}`}
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">
            {weekdayName(current.date)} · {formatTime12h(current.startTime)} –{" "}
            {formatTime12h(current.endTime)}
          </p>
        </div>

        <div
          className={`rounded-lg border p-3 ${
            changed ? "border-[var(--color-brand-300)] bg-[var(--color-brand-50)]" : "border-slate-200"
          }`}
        >
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
            Moving to
          </p>
          <p className="mt-1 text-sm font-semibold text-[var(--color-ink-900)]">
            {date ? formatDateLong(date) : "—"}
            {endDate && ` – ${formatDateLong(endDate)}`}
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">
            {date && `${weekdayName(date)} · `}
            {formatTime12h(startTime)} – {formatTime12h(endTime)}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Labelled label="New date">
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setPendingConflicts([]);
            }}
            className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
          />
        </Labelled>
        <Labelled label="Start">
          <input
            type="time"
            value={startTime}
            onChange={(e) => {
              setStartTime(e.target.value);
              setPendingConflicts([]);
            }}
            className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
          />
        </Labelled>
        <Labelled label="End">
          <input
            type="time"
            value={endTime}
            onChange={(e) => {
              setEndTime(e.target.value);
              setPendingConflicts([]);
            }}
            className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
          />
        </Labelled>
        {current.endDate !== null && (
          <Labelled label="Last day">
            <input
              type="date"
              value={endDate ?? ""}
              onChange={(e) => setEndDate(e.target.value || null)}
              className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
            />
          </Labelled>
        )}
      </div>

      {check && check.conflicts.length > 0 && pendingConflicts.length === 0 && (
        <div className="mt-4">
          <ConflictList conflicts={check.conflicts} />
        </div>
      )}
      {check && check.warnings.length > 0 && (
        <div className="mt-3">
          <WarningList warnings={check.warnings} />
        </div>
      )}
      {check && check.ok && check.conflicts.length === 0 && changed && (
        <p className="mt-3 text-xs font-semibold text-[var(--color-status-open)]">
          ✓ No scheduling conflicts at the new time
        </p>
      )}

      {pendingConflicts.length > 0 && (
        <div className="mt-4 rounded-lg border border-[var(--color-status-full-line)] p-3">
          <ConflictList conflicts={pendingConflicts} />
          <p className="mt-3 text-sm">
            Move it anyway, or pick a different slot?
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => move(true)}
              disabled={isSaving}
              className="rounded-lg bg-[var(--color-status-full)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              Move anyway
            </button>
            <button
              type="button"
              onClick={() => setPendingConflicts([])}
              className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold"
            >
              Pick another slot
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-[var(--color-status-cancelled-bg)] px-3 py-2 text-sm text-[var(--color-status-cancelled)]">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => move(false)}
          disabled={!changed || isSaving || pendingConflicts.length > 0}
          className="rounded-lg bg-[var(--color-brand-600)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-brand-700)] disabled:opacity-50"
        >
          {isSaving ? "Moving…" : "Confirm move"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setPendingConflicts([]);
          }}
          className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ========================================================================== *
 * Status changes
 * ========================================================================== */

const DESTRUCTIVE: EventStatus[] = ["CANCELLED"];

export function StatusPanel({
  eventId,
  currentStatus,
  registeredCount,
}: {
  eventId: string;
  currentStatus: EventStatus;
  registeredCount: number;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<EventStatus | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  // RESCHEDULED is a valid transition, but never a manual one: it means "the
  // date moved", and it is set automatically by the move flow above. Offering
  // a non-technical user a "Mark as rescheduled" button that changes a label
  // without changing any date is exactly the kind of control that makes people
  // distrust an admin tool.
  const options = allowedTransitions(currentStatus).filter((s) => s !== "RESCHEDULED");

  function commit(status: EventStatus) {
    setError(null);
    startSaving(async () => {
      let result;
      try {
        result = await setEventStatus(eventId, status, reason);
      } catch {
        setError("Could not reach the server. Check your connection and try again.");
        return;
      }
      if (result.ok) {
        setTarget(null);
        setReason("");
        router.refresh();
        return;
      }
      setError(
        result.message ?? result.errors?.map((e) => e.message).join(" ") ?? "Could not update status.",
      );
    });
  }

  if (options.length === 0) {
    return (
      <p className="text-xs text-[var(--muted-foreground)]">
        This event is completed. Its status can no longer be changed, which keeps the record honest.
      </p>
    );
  }

  if (target) {
    const isCancel = target === "CANCELLED";
    return (
      <div className="rounded-lg border p-4">
        <h4 className="text-sm font-bold text-[var(--color-ink-900)]">
          {isCancel ? "Cancel this event?" : `Mark as ${STATUS_LABELS[target].toLowerCase()}?`}
        </h4>

        {isCancel && (
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
            The event stays visible on the public calendar with a clear CANCELLED label, and
            registration is closed.
            {registeredCount > 0 && (
              <>
                {" "}
                <strong className="font-semibold text-[var(--color-status-cancelled)]">
                  {registeredCount.toLocaleString()} people are already registered.
                </strong>{" "}
                Their registrations are kept so you can contact them.
              </>
            )}
          </p>
        )}

        <label className="mt-3 block text-xs font-semibold text-[var(--color-ink-900)]">
          {isCancel ? "Reason (shown publicly)" : "Note for the audit log"}
        </label>
        <textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={
            isCancel
              ? "Cancelled due to venue flooding. A replacement date will be announced."
              : "Optional"
          }
          className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm"
        />

        {error && (
          <p className="mt-2 text-xs text-[var(--color-status-cancelled)]">{error}</p>
        )}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => commit(target)}
            disabled={isSaving}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
              isCancel
                ? "bg-[var(--color-status-cancelled)]"
                : "bg-[var(--color-ink-900)]"
            }`}
          >
            {isSaving ? "Saving…" : isCancel ? "Cancel event" : "Confirm"}
          </button>
          <button
            type="button"
            onClick={() => {
              setTarget(null);
              setError(null);
            }}
            className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((status) => (
        <button
          key={status}
          type="button"
          onClick={() => setTarget(status)}
          className={`rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-slate-50 ${
            DESTRUCTIVE.includes(status)
              ? "border-[var(--color-status-cancelled-line)] text-[var(--color-status-cancelled)]"
              : "bg-white"
          }`}
        >
          {status === "CANCELLED"
            ? "Cancel event"
            : status === "UPCOMING" && currentStatus === "CANCELLED"
              ? "Reinstate event"
              : `Mark as ${STATUS_LABELS[status].toLowerCase()}`}
        </button>
      ))}
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1 block text-xs font-semibold text-[var(--color-ink-900)]">{label}</span>
      {children}
    </div>
  );
}
