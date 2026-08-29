"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { EventWithAvailability } from "@/lib/domain/types";
import {
  AUDIENCE_LABELS,
  CATEGORY_LABELS,
  EVENT_AUDIENCES,
  EVENT_CATEGORIES,
} from "@/lib/domain/types";
import { deriveStatus } from "@/lib/domain/availability";
import {
  eventDates,
  formatTime12h,
  monthGrid,
  monthName,
  shiftMonth,
  toDateKey,
  toTimeKey,
} from "@/lib/domain/time";
import { EventCard } from "./event-card";

/**
 * The public calendar.
 *
 * WHY EVERYTHING IS FILTERED IN THE BROWSER:
 * Talentbank runs about 50 events a year. The entire dataset is a few dozen
 * rows, so the server sends all of them once and every filter keystroke is
 * instant with no network round trip. Server-side filtering would add latency
 * and a loading state to solve a problem this dataset does not have. If the
 * calendar ever grew to thousands of events, the filters would move to the
 * database query in `listEvents` — which already supports them.
 */

type ViewMode = "month" | "list";

const STATUS_FILTERS = [
  { value: "ALL", label: "All events" },
  { value: "OPEN", label: "Open for registration" },
  { value: "HIDE_PAST", label: "Hide past events" },
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

interface Props {
  events: EventWithAvailability[];
  today: string;
  nowIso: string;
  states: string[];
}

export function CalendarExplorer({ events, today, nowIso, states }: Props) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [year, setYear] = useState(() => Number(today.slice(0, 4)));
  const [month, setMonth] = useState(() => Number(today.slice(5, 7)));
  const [view, setView] = useState<ViewMode>("month");

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("ALL");
  const [audience, setAudience] = useState<string>("ALL");
  const [state, setState] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

  const hasFilters =
    search !== "" || category !== "ALL" || audience !== "ALL" || state !== "ALL" || statusFilter !== "ALL";

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return events.filter((event) => {
      if (category !== "ALL" && event.category !== category) return false;
      if (audience !== "ALL" && event.audience !== audience) return false;
      if (state !== "ALL" && event.state !== state) return false;

      const status = deriveStatus(event, now);
      if (statusFilter === "OPEN" && status !== "UPCOMING" && status !== "RESCHEDULED") return false;
      if (statusFilter === "HIDE_PAST" && status === "COMPLETED") return false;

      if (term) {
        const haystack =
          `${event.title} ${event.location} ${event.state} ${event.description}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [events, search, category, audience, state, statusFilter, now]);

  /** date key -> events touching that day (multi-day fairs appear on each day). */
  const byDate = useMemo(() => {
    const map = new Map<string, EventWithAvailability[]>();
    for (const event of filtered) {
      for (const day of eventDates(event.startAt, event.lastDate)) {
        const list = map.get(day);
        if (list) list.push(event);
        else map.set(day, [event]);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    }
    return map;
  }, [filtered]);

  const grid = useMemo(() => monthGrid(year, month), [year, month]);
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;

  const monthEvents = useMemo(
    () =>
      filtered
        .filter((event) =>
          eventDates(event.startAt, event.lastDate).some((d: string) => d.startsWith(monthPrefix)),
        )
        .sort((a, b) => a.startAt.getTime() - b.startAt.getTime()),
    [filtered, monthPrefix],
  );

  /** For list view: upcoming-first, grouped by month heading. */
  const grouped = useMemo(() => {
    const groups = new Map<string, EventWithAvailability[]>();
    for (const event of [...filtered].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())) {
      const key = toDateKey(event.startAt).slice(0, 7);
      const list = groups.get(key);
      if (list) list.push(event);
      else groups.set(key, [event]);
    }
    return [...groups.entries()];
  }, [filtered]);

  function step(delta: number) {
    const next = shiftMonth(year, month, delta);
    setYear(next.year);
    setMonth(next.month);
  }

  function resetFilters() {
    setSearch("");
    setCategory("ALL");
    setAudience("ALL");
    setState("ALL");
    setStatusFilter("ALL");
  }

  function goToToday() {
    setYear(Number(today.slice(0, 4)));
    setMonth(Number(today.slice(5, 7)));
  }

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------- filters */}
      <div className="card p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <label htmlFor="search" className="sr-only">
              Search events
            </label>
            <div className="relative">
              <svg
                viewBox="0 0 24 24"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" strokeLinecap="round" />
              </svg>
              <input
                id="search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, venue or state"
                className="w-full rounded-lg border bg-white py-2 pl-9 pr-3 text-sm placeholder:text-[var(--muted-foreground)]"
              />
            </div>
          </div>

          <Select label="Type" value={category} onChange={setCategory}>
            <option value="ALL">All types</option>
            {EVENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>

          <Select label="Audience" value={audience} onChange={setAudience}>
            <option value="ALL">Everyone</option>
            {EVENT_AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {AUDIENCE_LABELS[a]}
              </option>
            ))}
          </Select>

          <Select label="State" value={state} onChange={setState}>
            <option value="ALL">All states</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
          {STATUS_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setStatusFilter(option.value)}
              aria-pressed={statusFilter === option.value}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                statusFilter === option.value
                  ? "bg-[var(--color-ink-900)] text-white"
                  : "bg-slate-100 text-[var(--muted-foreground)] hover:bg-slate-200"
              }`}
            >
              {option.label}
            </button>
          ))}
          <span className="ml-auto text-xs text-[var(--muted-foreground)]">
            {filtered.length} of {events.length} events
          </span>
          {hasFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-md px-2 py-1 text-xs font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)]"
            >
              Reset filters
            </button>
          )}
        </div>
      </div>

      {/* ------------------------------------------------- month navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous month"
            className="grid size-9 place-items-center rounded-lg border bg-white hover:bg-slate-50"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m14 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <h2 className="min-w-[11rem] text-center text-lg font-bold text-[var(--color-ink-900)]">
            {monthName(month)} {year}
          </h2>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next month"
            className="grid size-9 place-items-center rounded-lg border bg-white hover:bg-slate-50"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m10 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={goToToday}
            className="ml-1 rounded-lg border bg-white px-3 py-2 text-xs font-semibold hover:bg-slate-50"
          >
            Today
          </button>
        </div>

        <div className="flex rounded-lg border bg-white p-0.5">
          {(["month", "list"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setView(mode)}
              aria-pressed={view === mode}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                view === mode
                  ? "bg-[var(--color-ink-900)] text-white"
                  : "text-[var(--muted-foreground)] hover:bg-slate-100"
              }`}
            >
              {mode === "month" ? "Month" : "List"}
            </button>
          ))}
        </div>
      </div>

      {view === "month" ? (
        <>
          {/* -------------------------------------------------- month grid */}
          <div className="card overflow-hidden">
            <div className="grid grid-cols-7 border-b bg-[var(--surface-muted)]">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                <div
                  key={day}
                  className="px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]"
                >
                  <span className="hidden sm:inline">{day}</span>
                  <span className="sm:hidden">{day[0]}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {grid.map((day, index) => {
                const inMonth = day.startsWith(monthPrefix);
                const isToday = day === today;
                const dayEvents = byDate.get(day) ?? [];
                return (
                  <div
                    key={day}
                    className={`min-h-24 border-b border-r p-1.5 sm:min-h-30 ${
                      index % 7 === 6 ? "border-r-0" : ""
                    } ${inMonth ? "" : "bg-[var(--surface-muted)]/60"}`}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span
                        className={`grid size-6 place-items-center rounded-full text-xs font-semibold ${
                          isToday
                            ? "bg-[var(--color-brand-600)] text-white"
                            : inMonth
                              ? "text-[var(--foreground)]"
                              : "text-slate-300"
                        }`}
                      >
                        {Number(day.slice(8, 10))}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {dayEvents.slice(0, 2).map((event) => (
                        <DayPill key={event.id} event={event} day={day} now={now} />
                      ))}
                      {dayEvents.length > 2 && (
                        <p className="px-1 text-[10px] font-semibold text-[var(--muted-foreground)]">
                          +{dayEvents.length - 2} more
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ------------------------------------------- this month's cards */}
          <section aria-labelledby="month-events">
            <h3 id="month-events" className="mb-3 text-sm font-bold text-[var(--color-ink-900)]">
              {monthEvents.length === 0
                ? `No events in ${monthName(month)} ${year}`
                : `${monthEvents.length} ${monthEvents.length === 1 ? "event" : "events"} in ${monthName(month)} ${year}`}
            </h3>
            {monthEvents.length === 0 ? (
              <EmptyState hasFilters={hasFilters} onReset={resetFilters} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {monthEvents.map((event) => (
                  <EventCard key={event.id} event={event} now={now} today={today} />
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        /* ------------------------------------------------------ list view */
        <div className="space-y-8">
          {grouped.length === 0 ? (
            <EmptyState hasFilters={hasFilters} onReset={resetFilters} />
          ) : (
            grouped.map(([key, list]) => (
              <section key={key} aria-labelledby={`group-${key}`}>
                <h3
                  id={`group-${key}`}
                  className="mb-3 border-b pb-2 text-sm font-bold text-[var(--color-ink-900)]"
                >
                  {monthName(Number(key.slice(5, 7)))} {key.slice(0, 4)}
                  <span className="ml-2 font-normal text-[var(--muted-foreground)]">
                    · {list.length} {list.length === 1 ? "event" : "events"}
                  </span>
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((event) => (
                    <EventCard key={event.id} event={event} now={now} today={today} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function DayPill({
  event,
  day,
  now,
}: {
  event: EventWithAvailability;
  day: string;
  now: Date;
}) {
  const status = deriveStatus(event, now);
  const isFirstDay = toDateKey(event.startAt) === day;

  const tone =
    status === "CANCELLED"
      ? "bg-[var(--color-status-cancelled-bg)] text-[var(--color-status-cancelled)] line-through"
      : status === "FULL"
        ? "bg-[var(--color-status-full-bg)] text-[var(--color-status-full)]"
        : status === "COMPLETED"
          ? "bg-slate-100 text-slate-500"
          : "bg-[var(--color-brand-50)] text-[var(--color-brand-800)]";

  return (
    <Link
      href={`/events/${event.slug}`}
      title={`${event.title} — ${event.location}`}
      className={`block truncate rounded px-1.5 py-1 text-[10px] font-semibold leading-tight hover:brightness-95 sm:text-[11px] ${tone}`}
    >
      {isFirstDay && status !== "CANCELLED" && (
        <span className="mr-1 font-bold tabular-nums opacity-70">
          {formatTime12h(toTimeKey(event.startAt)).replace(":00", "")}
        </span>
      )}
      {event.title}
    </Link>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="sr-only">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
      >
        {children}
      </select>
    </div>
  );
}

function EmptyState({ hasFilters, onReset }: { hasFilters: boolean; onReset: () => void }) {
  return (
    <div className="card p-10 text-center">
      <p className="text-sm font-semibold text-[var(--color-ink-900)]">No career fairs found</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--muted-foreground)]">
        {hasFilters
          ? "Nothing matches these filters. Try widening your search or looking at another month."
          : "There are no events scheduled in this month yet."}
      </p>
      {hasFilters && (
        <button
          type="button"
          onClick={onReset}
          className="mt-4 rounded-lg bg-[var(--color-ink-900)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-ink-800)]"
        >
          Reset filters
        </button>
      )}
    </div>
  );
}
