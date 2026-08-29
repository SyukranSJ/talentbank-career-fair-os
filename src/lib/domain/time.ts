/**
 * Time helpers — pure functions, no dependencies.
 *
 * WHY NO TIMEZONE LIBRARY?
 * Every event in this system happens in Malaysia. Malaysia has been on a fixed
 * UTC+08:00 offset since 1982 and observes no daylight saving time. That means
 * the conversion between "what the events team types into a form" and "what we
 * store in Postgres" is a constant offset, so a timezone library would add a
 * dependency without removing a single bug.
 *
 * THE RULE, stated once so it is never ambiguous:
 *   - Postgres stores `timestamptz`, i.e. an absolute instant, normalised to UTC.
 *   - Admins type, and the public reads, Malaysian wall-clock time.
 *   - Every conversion in the app goes through this file. Nothing else is
 *     allowed to call `new Date(...)` on a user-supplied string, and nothing
 *     else is allowed to use `getHours()` / `getDate()` (those read the
 *     *server's* timezone, which on Vercel is UTC and would silently shift
 *     every event back by 8 hours).
 */

export const KL_TIME_ZONE = "Asia/Kuala_Lumpur";
export const KL_UTC_OFFSET = "+08:00";

/** Business hours a career fair is normally allowed to run within (KL time). */
export const BUSINESS_HOURS = { startHour: 8, endHour: 20 } as const;

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** A calendar day in Malaysia, as `YYYY-MM-DD`. */
export type DateKey = string;
/** A wall-clock time in Malaysia, as `HH:mm` (24h). */
export type TimeKey = string;

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_KEY_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isDateKey(value: string): value is DateKey {
  if (!DATE_KEY_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Reject impossible days such as 2026-02-30.
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export function isTimeKey(value: string): value is TimeKey {
  return TIME_KEY_RE.test(value);
}

/**
 * Turn a Malaysian wall-clock date + time into the absolute instant we store.
 * `fromKL("2026-09-18", "10:00")` -> 2026-09-18T02:00:00.000Z
 */
export function fromKL(date: DateKey, time: TimeKey): Date {
  if (!isDateKey(date)) throw new Error(`Invalid date "${date}", expected YYYY-MM-DD`);
  if (!isTimeKey(time)) throw new Error(`Invalid time "${time}", expected HH:mm`);
  const instant = new Date(`${date}T${time}:00.000${KL_UTC_OFFSET}`);
  if (Number.isNaN(instant.getTime())) throw new Error(`Could not parse ${date} ${time}`);
  return instant;
}

/** Every component of an instant, expressed in Malaysian wall-clock time. */
export function klParts(instant: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
} {
  // Shift the instant by the fixed offset, then read UTC fields. Reading UTC
  // fields is the only way to avoid picking up the host machine's timezone.
  const shifted = new Date(instant.getTime() + 8 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The Malaysian calendar day an instant falls on, e.g. "2026-09-18". */
export function toDateKey(instant: Date): DateKey {
  const { year, month, day } = klParts(instant);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The Malaysian wall-clock time an instant falls on, e.g. "10:00". */
export function toTimeKey(instant: Date): TimeKey {
  const { hour, minute } = klParts(instant);
  return `${pad(hour)}:${pad(minute)}`;
}

/** "10:00" -> "10:00 AM"  ·  "17:30" -> "5:30 PM" */
export function formatTime12h(time: TimeKey): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}:00 ${suffix}` : `${hour12}:${pad(m)} ${suffix}`;
}

/** "2026-09-18" -> "18 September 2026" (Malaysian/British convention). */
export function formatDateLong(date: DateKey): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

/** "2026-09-18" -> "18 Sep 2026" */
export function formatDateShort(date: DateKey): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)} ${y}`;
}

/** "2026-09-18" -> "Friday" */
export function weekdayName(date: DateKey): string {
  return WEEKDAY_NAMES[weekdayIndex(date)];
}

/** "2026-09-18" -> 5 (0 = Sunday) */
export function weekdayIndex(date: DateKey): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1];
}

/** Compact form used on cards: "10:00 AM – 5:00 PM" or "10:00 AM – 4 Oct, 6:00 PM". */
export function formatTimeRange(startAt: Date, endAt: Date): string {
  const startDate = toDateKey(startAt);
  const endDate = toDateKey(endAt);
  const startTime = formatTime12h(toTimeKey(startAt));
  const endTime = formatTime12h(toTimeKey(endAt));
  if (startDate === endDate) return `${startTime} – ${endTime}`;
  const [, m, d] = endDate.split("-").map(Number);
  return `${startTime} – ${d} ${MONTH_NAMES[m - 1].slice(0, 3)}, ${endTime}`;
}

/** Calendar arithmetic on date keys. Never touches timezones. */
export function addDays(date: DateKey, days: number): DateKey {
  const instant = new Date(`${date}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

export function daysBetween(from: DateKey, to: DateKey): number {
  const a = new Date(`${from}T00:00:00.000Z`).getTime();
  const b = new Date(`${to}T00:00:00.000Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** First day of a month, e.g. (2026, 9) -> "2026-09-01". */
export function monthStart(year: number, month: number): DateKey {
  return `${year}-${pad(month)}-01`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The 6x7 grid a month view renders, Monday-first (Malaysian convention),
 * including the leading/trailing days from adjacent months.
 */
export function monthGrid(year: number, month: number): DateKey[] {
  const first = monthStart(year, month);
  // Monday-first: Monday=0 ... Sunday=6
  const offset = (weekdayIndex(first) + 6) % 7;
  const start = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** Steps a (year, month) pair forwards or backwards without rolling over wrong. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

/* -------------------------------------------------------------------------- *
 * Multi-day events
 *
 * A two-day career fair runs 10:00-17:00 ON EACH DAY. It is not one 31-hour
 * session that continues overnight. The database stores that as:
 *
 *   start_at   first day's start          2026-10-01 10:00
 *   end_at     FIRST day's end            2026-10-01 17:00   <- the daily window
 *   last_date  last calendar day          2026-10-02         (null = single day)
 *
 * so the daily hours are time(start_at)..time(end_at), repeated on every day
 * from date(start_at) through last_date. Storing end_at on the LAST day, as
 * this project originally did, loses the daily hours entirely and makes an
 * evening event on night one look like a venue clash.
 * -------------------------------------------------------------------------- */

/** One day's sitting of an event. */
export interface Occurrence {
  date: DateKey;
  start: Date;
  end: Date;
}

/** Every calendar day an event runs on, so it renders in each cell. */
export function eventDates(startAt: Date, lastDate: DateKey | null): DateKey[] {
  const first = toDateKey(startAt);
  if (!lastDate || lastDate <= first) return [first];

  const out: DateKey[] = [first];
  let cursor = first;
  // Bounded so a malformed row cannot produce an unbounded loop.
  for (let i = 0; i < 30 && cursor < lastDate; i += 1) {
    cursor = addDays(cursor, 1);
    out.push(cursor);
  }
  return out;
}

/**
 * The actual sittings of an event — one interval per day, each using the same
 * daily hours. This is what conflict detection compares, so a fair that closes
 * at 18:00 does not block a 19:30 event that evening.
 */
export function eventOccurrences(
  startAt: Date,
  endAt: Date,
  lastDate: DateKey | null,
): Occurrence[] {
  const startTime = toTimeKey(startAt);
  const endTime = toTimeKey(endAt);
  // A single-day event whose end time is before its start time would be
  // invalid; validation rejects that, so this is a straight repeat per day.
  return eventDates(startAt, lastDate).map((date) => ({
    date,
    start: fromKL(date, startTime),
    end: fromKL(date, endTime),
  }));
}

/**
 * When the event is genuinely over — the END of its LAST day. Used for the
 * COMPLETED status and the registration cut-off, both of which would otherwise
 * close a two-day fair at the end of day one.
 */
export function eventFinishesAt(
  startAt: Date,
  endAt: Date,
  lastDate: DateKey | null,
): Date {
  const occurrences = eventOccurrences(startAt, endAt, lastDate);
  return occurrences[occurrences.length - 1].end;
}

export function isMultiDay(startAt: Date, lastDate: DateKey | null): boolean {
  return Boolean(lastDate && lastDate > toDateKey(startAt));
}

/**
 * A natural day range: "1–2 October 2026", collapsing the parts that repeat.
 *   same month  -> "1–2 October 2026"
 *   same year   -> "30 October – 1 November 2026"
 *   otherwise   -> "31 December 2026 – 1 January 2027"
 */
export function formatDayRange(startDate: DateKey, lastDate: DateKey | null): string {
  if (!lastDate || lastDate <= startDate) return formatDateLong(startDate);

  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = lastDate.split("-").map(Number);

  if (sy === ey && sm === em) return `${sd}–${ed} ${MONTH_NAMES[sm - 1]} ${sy}`;
  if (sy === ey) return `${sd} ${MONTH_NAMES[sm - 1]} – ${ed} ${MONTH_NAMES[em - 1]} ${sy}`;
  return `${formatDateLong(startDate)} – ${formatDateLong(lastDate)}`;
}

/** "10:00 AM – 5:00 PM", with "each day" appended when it repeats. */
export function formatDailyHours(
  startAt: Date,
  endAt: Date,
  lastDate: DateKey | null,
): string {
  const hours = `${formatTime12h(toTimeKey(startAt))} – ${formatTime12h(toTimeKey(endAt))}`;
  return isMultiDay(startAt, lastDate) ? `${hours} each day` : hours;
}

/** "1–2 October 2026 · 10:00 AM – 5:00 PM each day" — the one-line summary. */
export function formatEventSchedule(
  startAt: Date,
  endAt: Date,
  lastDate: DateKey | null,
): string {
  return `${formatDayRange(toDateKey(startAt), lastDate)} · ${formatDailyHours(startAt, endAt, lastDate)}`;
}

/**
 * "Today" / "In 3 days" / "In 2 weeks" — the "plan your week" framing.
 *
 * Returns NULL once the distance is too large for a relative phrase to help.
 * It used to fall back to a short date, which read fine in isolation but was
 * always rendered beside the full date, so an event in November displayed as
 * "21 November 2026 … Saturday · 21 Nov 2026" — the same date twice, in two
 * formats. Callers now omit the label entirely when there is nothing useful
 * to say, which is the honest answer for a date four months out.
 */
export function relativeDayLabel(target: DateKey, today: DateKey): string | null {
  const diff = daysBetween(today, target);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff <= 7) return `In ${diff} days`;
  if (diff > 7 && diff <= 28) {
    const weeks = Math.round(diff / 7);
    return weeks === 1 ? "In 1 week" : `In ${weeks} weeks`;
  }
  if (diff < -1 && diff >= -28) return `${Math.abs(diff)} days ago`;
  return null;
}
