/**
 * Validation rules — the single gate every write passes through.
 *
 * THE POINT OF THIS FILE:
 * A human filling in the "Add event" form and the AI Copilot proposing an event
 * both produce the same shape, and both are validated by the *same* schema here.
 * The Copilot has no separate, more permissive path into the database. That is
 * the whole safety argument of the project, and it only holds because this
 * module has no idea whether its caller was a person or a model.
 */

import { z } from "zod";
import {
  EVENT_AUDIENCES,
  EVENT_CATEGORIES,
  EVENT_STATUSES,
  MALAYSIAN_STATES,
  USER_TYPES,
} from "./types";
import {
  BUSINESS_HOURS,
  daysBetween,
  fromKL,
  isDateKey,
  isTimeKey,
  klParts,
  type DateKey,
} from "./time";

const dateKeySchema = z
  .string()
  .refine(isDateKey, { message: "Use a real calendar date in YYYY-MM-DD form" });

const timeKeySchema = z
  .string()
  .refine(isTimeKey, { message: "Use a 24-hour time in HH:mm form" });

/**
 * What the admin form posts. Dates and times stay as Malaysian wall-clock
 * strings right up until `toEventTimes` converts them, so nothing in the form
 * layer has to reason about UTC.
 */
export const eventInputSchema = z.object({
  title: z.string().trim().min(3, "Title needs at least 3 characters").max(120, "Title is too long"),
  description: z.string().trim().max(4000, "Description is too long").default(""),
  date: dateKeySchema,
  /** Omitted for single-day events; set for fairs that run across two or more days. */
  endDate: dateKeySchema.optional(),
  startTime: timeKeySchema,
  endTime: timeKeySchema,
  location: z.string().trim().min(2, "Add a venue").max(160, "Venue name is too long"),
  state: z.enum(MALAYSIAN_STATES),
  category: z.enum(EVENT_CATEGORIES),
  audience: z.enum(EVENT_AUDIENCES),
  capacity: z.coerce
    .number()
    .int("Capacity must be a whole number")
    .min(1, "Capacity must be at least 1")
    .max(100_000, "Capacity looks unrealistically large"),
  status: z.enum(EVENT_STATUSES).default("UPCOMING"),
});

export type EventInput = z.input<typeof eventInputSchema>;
export type ParsedEventInput = z.output<typeof eventInputSchema>;

/** Maximum length of a single fair. Talentbank's longest real event is 2 days. */
const MAX_EVENT_DAYS = 7;

export interface EventTimes {
  /** First day's start. */
  startAt: Date;
  /** FIRST day's end, so the daily hours survive persistence. */
  endAt: Date;
  /** Last calendar day, or null for a single-day event. */
  lastDate: DateKey | null;
}

/**
 * Converts validated form fields into the two instants we store, and enforces
 * the rules that need both ends of the range at once.
 */
export function toEventTimes(input: ParsedEventInput): EventTimes {
  // Both instants are on the FIRST day. `endDate` becomes lastDate rather than
  // being folded into endAt — folding it in was what destroyed the daily hours
  // and turned a two-day fair into one 31-hour block.
  const startAt = fromKL(input.date, input.startTime);
  const endAt = fromKL(input.date, input.endTime);
  const lastDate = input.endDate && input.endDate > input.date ? input.endDate : null;
  return { startAt, endAt, lastDate };
}

export interface RuleIssue {
  field: string;
  message: string;
}

/**
 * Hard errors block the write. Soft warnings are shown to the admin and can be
 * overridden — the same "inform, don't obstruct" stance as conflict detection.
 */
export interface RuleResult {
  errors: RuleIssue[];
  warnings: RuleIssue[];
}

export function checkEventTimeRules(input: ParsedEventInput, now: Date): RuleResult {
  const errors: RuleIssue[] = [];
  const warnings: RuleIssue[] = [];
  const { startAt, endAt, lastDate } = toEventTimes(input);

  // Daily hours: the finish time must be later than the start time on the SAME
  // day, which is what an attendee reads off the page.
  if (endAt.getTime() <= startAt.getTime()) {
    errors.push({ field: "endTime", message: "The event must finish after it starts." });
  }

  if (input.endDate && input.endDate < input.date) {
    errors.push({ field: "endDate", message: "The last day cannot be before the first day." });
  }

  const days = lastDate ? daysBetween(input.date, lastDate) + 1 : 1;
  if (days > MAX_EVENT_DAYS) {
    errors.push({
      field: "endDate",
      message: `An event cannot run longer than ${MAX_EVENT_DAYS} days.`,
    });
  }

  // Scheduling into the past is a warning, not an error: the events team
  // sometimes back-fills a fair that already happened so the archive is complete.
  if (startAt.getTime() < now.getTime() && input.status === "UPCOMING") {
    warnings.push({
      field: "date",
      message: "This start time is in the past, so the event will immediately show as completed.",
    });
  }

  const startHour = klParts(startAt).hour;
  const endParts = klParts(endAt);
  const endHour = endParts.hour + (endParts.minute > 0 ? 1 : 0);
  if (startHour < BUSINESS_HOURS.startHour || endHour > BUSINESS_HOURS.endHour) {
    warnings.push({
      field: "startTime",
      message: `Career fairs normally run between ${BUSINESS_HOURS.startHour}:00 and ${BUSINESS_HOURS.endHour}:00. Double-check these hours.`,
    });
  }

  return { errors, warnings };
}

/** Full validation of a create/update payload, returning a typed result. */
export type ValidationOutcome =
  | { ok: true; value: ParsedEventInput; times: EventTimes; warnings: RuleIssue[] }
  | { ok: false; errors: RuleIssue[] };

export function validateEventInput(raw: unknown, now: Date): ValidationOutcome {
  const parsed = eventInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        field: issue.path.join(".") || "form",
        message: issue.message,
      })),
    };
  }

  const ruleResult = checkEventTimeRules(parsed.data, now);
  if (ruleResult.errors.length > 0) {
    return { ok: false, errors: ruleResult.errors };
  }

  return {
    ok: true,
    value: parsed.data,
    times: toEventTimes(parsed.data),
    warnings: ruleResult.warnings,
  };
}

/* ------------------------------------------------------------------ *
 * Registration
 * ------------------------------------------------------------------ */

/**
 * Deliberately stricter than `z.string().email()` on the shape of the domain:
 * a career-fair mailing list full of typo'd addresses is a real operational
 * cost, and this catches "gmail.con"-class mistakes at the point of entry.
 */
export const registrationInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Please enter your full name")
    .max(120, "That name is too long"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(5, "Please enter your email address")
    .max(254, "That email address is too long")
    .regex(
      /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/,
      "Please enter a valid email address, for example name@example.com",
    ),
  userType: z.enum(USER_TYPES, { message: "Tell us whether you are a candidate or an employer" }),
});

export type RegistrationInput = z.output<typeof registrationInputSchema>;

export type RegistrationValidation =
  | { ok: true; value: RegistrationInput }
  | { ok: false; errors: RuleIssue[] };

export function validateRegistrationInput(raw: unknown): RegistrationValidation {
  const parsed = registrationInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        field: issue.path.join(".") || "form",
        message: issue.message,
      })),
    };
  }
  return { ok: true, value: parsed.data };
}

/** URL-safe slug derived from the title, with a short suffix for uniqueness. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 70);
}
