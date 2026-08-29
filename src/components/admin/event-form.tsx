"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  checkEventProposal,
  createEvent,
  updateEvent,
  type ProposalCheck,
} from "@/lib/actions/events";
import {
  AUDIENCE_LABELS,
  CATEGORY_LABELS,
  EVENT_AUDIENCES,
  EVENT_CATEGORIES,
  MALAYSIAN_STATES,
  STATUS_LABELS,
} from "@/lib/domain/types";
import type { EventStatus } from "@/lib/domain/types";
import { allowedTransitions } from "@/lib/domain/availability";
import { ConflictList, WarningList } from "./conflict-list";

export interface EventFormValues {
  title: string;
  description: string;
  date: string;
  endDate?: string;
  startTime: string;
  endTime: string;
  location: string;
  state: string;
  category: string;
  audience: string;
  capacity: number;
  status: EventStatus;
}

const BLANK: EventFormValues = {
  title: "",
  description: "",
  date: "",
  endDate: undefined,
  startTime: "10:00",
  endTime: "17:00",
  location: "",
  state: "Kuala Lumpur",
  category: "PUBLIC_CAREER_FAIR",
  audience: "EVERYONE",
  capacity: 200,
  status: "UPCOMING",
};

/**
 * One form for creating and editing.
 *
 * The important behaviour is the CONFLICT DIALOGUE: saving with an overlapping
 * event does not fail silently and does not fail permanently. The first save
 * attempt comes back with the conflicts listed; the admin reads them and either
 * changes the date or presses "Save anyway". That is the whole point — the
 * system informs, the human decides.
 */
export function EventForm({
  mode,
  eventId,
  initial,
  registeredCount = 0,
}: {
  mode: "create" | "edit";
  eventId?: string;
  initial?: EventFormValues;
  registeredCount?: number;
}) {
  const router = useRouter();
  const [values, setValues] = useState<EventFormValues>(initial ?? BLANK);
  const [multiDay, setMultiDay] = useState(Boolean(initial?.endDate));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingConflicts, setPendingConflicts] = useState<ProposalCheck["conflicts"]>([]);
  const [liveCheck, setLiveCheck] = useState<ProposalCheck | null>(null);
  const [isSaving, startSaving] = useTransition();

  const statusOptions = useMemo(() => {
    if (mode === "create") return ["UPCOMING", "FULL"] as EventStatus[];
    const current = initial?.status ?? "UPCOMING";
    return [current, ...allowedTransitions(current)];
  }, [mode, initial?.status]);

  function set<K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setPendingConflicts([]);
  }

  /* ---- live conflict preview -------------------------------------------
   * A read-only dry run runs shortly after the schedule fields settle, so the
   * admin sees a clash while they are still choosing a date rather than after
   * they press Save. It changes nothing.
   * --------------------------------------------------------------------- */
  const scheduleKey = `${values.date}|${multiDay ? values.endDate : ""}|${values.startTime}|${values.endTime}|${values.location}|${values.state}`;

  useEffect(() => {
    // The whole effect is debounced, including clearing a stale result, so no
    // state is set synchronously during render.
    const handle = setTimeout(async () => {
      const ready =
        Boolean(values.date) &&
        Boolean(values.startTime) &&
        Boolean(values.endTime) &&
        values.location.trim().length >= 2;

      if (!ready) {
        setLiveCheck(null);
        return;
      }

      // A failed server action here must never become an unhandled promise
      // rejection: the browser reports those as a bare "TypeError: Load
      // failed" in the console, which tells the person using the app nothing
      // and tells whoever debugs it almost as little. The live check is a
      // convenience, so losing it silently is the correct degradation.
      try {
        setLiveCheck(
          await checkEventProposal(
            {
              ...values,
              endDate: multiDay ? values.endDate : undefined,
              title: values.title || "Draft event",
            },
            eventId,
          ),
        );
      } catch {
        setLiveCheck(null);
      }
    }, 500);

    return () => clearTimeout(handle);
    // Only re-run when a schedule-relevant field changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleKey, eventId]);

  function save(acknowledgeConflicts: boolean) {
    setFieldErrors({});
    setFormError(null);

    startSaving(async () => {
      const payload = { ...values, endDate: multiDay ? values.endDate : undefined };
      let result;
      try {
        result =
          mode === "create"
            ? await createEvent(payload, { acknowledgeConflicts })
            : await updateEvent(eventId!, payload, { acknowledgeConflicts });
      } catch {
        // Network drop, expired session, restarted server. Say so plainly
        // instead of leaving the button spinning forever.
        setFormError("Could not reach the server. Check your connection and try again.");
        return;
      }

      if (result.ok) {
        router.push(`/admin/events/${result.eventId}`);
        router.refresh();
        return;
      }

      if (result.conflicts?.length) {
        setPendingConflicts(result.conflicts);
        return;
      }
      if (result.errors?.length) {
        const errors: Record<string, string> = {};
        for (const issue of result.errors) errors[issue.field] = issue.message;
        setFieldErrors(errors);
        setFormError("Please fix the highlighted fields.");
        return;
      }
      setFormError(result.message ?? "Could not save this event.");
    });
  }

  const showConflictGate = pendingConflicts.length > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
      className="space-y-5"
    >
      {formError && (
        <p
          role="alert"
          className="rounded-lg bg-[var(--color-status-cancelled-bg)] px-3 py-2.5 text-sm font-medium text-[var(--color-status-cancelled)]"
        >
          {formError}
        </p>
      )}

      <section className="card p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
          Event details
        </h2>
        <div className="mt-4 space-y-4">
          <Text
            label="Event title"
            value={values.title}
            onChange={(v) => set("title", v)}
            error={fieldErrors.title}
            placeholder="Technology Career Fair"
            required
          />
          <TextArea
            label="Description"
            hint="Shown on the public event page. A sentence or two is enough."
            value={values.description}
            onChange={(v) => set("description", v)}
            error={fieldErrors.description}
          />
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
          When
        </h2>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          All times are Malaysia time (GMT+8).
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Text
            label="Date"
            type="date"
            value={values.date}
            onChange={(v) => set("date", v)}
            error={fieldErrors.date}
            required
          />
          <Text
            label="Start time"
            type="time"
            value={values.startTime}
            onChange={(v) => set("startTime", v)}
            error={fieldErrors.startTime}
            required
          />
          <Text
            label="End time"
            type="time"
            value={values.endTime}
            onChange={(v) => set("endTime", v)}
            error={fieldErrors.endTime}
            required
          />
        </div>

        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={multiDay}
            onChange={(e) => {
              setMultiDay(e.target.checked);
              if (e.target.checked && !values.endDate) set("endDate", values.date);
            }}
            className="size-4"
          />
          <span className="font-medium">This event runs across more than one day</span>
        </label>

        {multiDay && (
          <div className="mt-3 max-w-xs">
            <Text
              label="Last day"
              type="date"
              value={values.endDate ?? ""}
              onChange={(v) => set("endDate", v)}
              error={fieldErrors.endDate}
            />
          </div>
        )}

        {/* live, non-blocking conflict preview */}
        {liveCheck && liveCheck.conflicts.length > 0 && !showConflictGate && (
          <div className="mt-4">
            <ConflictList conflicts={liveCheck.conflicts} />
          </div>
        )}
        {liveCheck && liveCheck.warnings.length > 0 && (
          <div className="mt-3">
            <WarningList warnings={liveCheck.warnings} />
          </div>
        )}
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
          Where and who
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Text
            label="Venue"
            value={values.location}
            onChange={(v) => set("location", v)}
            error={fieldErrors.location}
            placeholder="Kuala Lumpur Convention Centre"
            required
          />
          <Choice
            label="State"
            value={values.state}
            onChange={(v) => set("state", v)}
            options={MALAYSIAN_STATES.map((s) => ({ value: s, label: s }))}
          />
          <Choice
            label="Event type"
            value={values.category}
            onChange={(v) => set("category", v)}
            options={EVENT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
          />
          <Choice
            label="Audience"
            value={values.audience}
            onChange={(v) => set("audience", v)}
            options={EVENT_AUDIENCES.map((a) => ({ value: a, label: AUDIENCE_LABELS[a] }))}
          />
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
          Capacity and status
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <Text
              label="Capacity"
              type="number"
              value={String(values.capacity)}
              onChange={(v) => set("capacity", Number(v))}
              error={fieldErrors.capacity}
              required
            />
            {registeredCount > 0 && (
              <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
                {registeredCount.toLocaleString()} people are already registered, so capacity
                cannot go below that.
              </p>
            )}
          </div>
          <Choice
            label="Status"
            value={values.status}
            onChange={(v) => set("status", v as EventStatus)}
            options={statusOptions.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
            hint="Registration closes automatically when capacity is reached, so you rarely need to set Full by hand."
          />
        </div>
      </section>

      {/* ------------------------------------------------ conflict decision */}
      {showConflictGate && (
        <div className="card border-[var(--color-status-full-line)] p-5">
          <ConflictList conflicts={pendingConflicts} />
          <p className="mt-3 text-sm text-[var(--foreground)]">
            Multiple events can legitimately run at the same time. Check the clashes above, then
            choose.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => save(true)}
              disabled={isSaving}
              className="rounded-lg bg-[var(--color-status-full)] px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-60"
            >
              {isSaving ? "Saving…" : "Save anyway"}
            </button>
            <button
              type="button"
              onClick={() => setPendingConflicts([])}
              className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
            >
              Go back and change the date
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={isSaving || showConflictGate}
          className="rounded-lg bg-[var(--color-brand-600)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--color-brand-700)] disabled:opacity-60"
        >
          {isSaving ? "Saving…" : mode === "create" ? "Create event" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50"
        >
          Cancel
        </button>
        {liveCheck && liveCheck.conflicts.length === 0 && values.date && (
          <span className="text-xs font-medium text-[var(--color-status-open)]">
            ✓ No scheduling conflicts
          </span>
        )}
      </div>
    </form>
  );
}

/* ------------------------------------------------------------- controls -- */

function Text({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  error,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  error?: string;
  required?: boolean;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-[var(--color-ink-900)]">
        {label}
        {required && <span className="ml-0.5 text-[var(--color-status-cancelled)]">*</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        className={`mt-1.5 w-full rounded-lg border bg-white px-3 py-2 text-sm ${
          error ? "border-[var(--color-status-cancelled)]" : ""
        }`}
      />
      {error && <p className="mt-1 text-xs text-[var(--color-status-cancelled)]">{error}</p>}
    </div>
  );
}

function TextArea({
  label,
  hint,
  value,
  onChange,
  error,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-[var(--color-ink-900)]">
        {label}
      </label>
      {hint && <p className="text-xs text-[var(--muted-foreground)]">{hint}</p>}
      <textarea
        id={id}
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-lg border bg-white px-3 py-2 text-sm"
      />
      {error && <p className="mt-1 text-xs text-[var(--color-status-cancelled)]">{error}</p>}
    </div>
  );
}

function Choice({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  hint?: string;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-[var(--color-ink-900)]">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-lg border bg-white px-3 py-2 text-sm"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && <p className="mt-1 text-xs text-[var(--muted-foreground)]">{hint}</p>}
    </div>
  );
}
