/**
 * The shared vocabulary of the system. Pure types + the enum values that the
 * database `CHECK` constraints also enforce, so the two can never drift apart
 * without a compile error somewhere.
 */

/** What the events team *intends*. Not always what the public sees — see `deriveStatus`. */
export const EVENT_STATUSES = [
  "UPCOMING",
  "FULL",
  "CANCELLED",
  "COMPLETED",
  "RESCHEDULED",
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Mirrors the real Talentbank event taxonomy. */
export const EVENT_CATEGORIES = [
  "UNIVERSITY_CAMPUS_FAIR",
  "SECTOR_FOCUSED_FAIR",
  "PUBLIC_CAREER_FAIR",
  "NETWORKING",
  "MENTORING",
  "SKILLS_WORKSHOP",
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const EVENT_AUDIENCES = ["EVERYONE", "CANDIDATES", "EMPLOYERS"] as const;
export type EventAudience = (typeof EVENT_AUDIENCES)[number];

export const USER_TYPES = ["CANDIDATE", "EMPLOYER"] as const;
export type UserType = (typeof USER_TYPES)[number];

/** Malaysian states/territories Talentbank runs fairs in. */
export const MALAYSIAN_STATES = [
  "Kuala Lumpur",
  "Putrajaya",
  "Selangor",
  "Penang",
  "Johor",
  "Perak",
  "Negeri Sembilan",
  "Melaka",
  "Kedah",
  "Sabah",
  "Sarawak",
  "Terengganu",
  "Pahang",
] as const;
export type MalaysianState = (typeof MALAYSIAN_STATES)[number];

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  UNIVERSITY_CAMPUS_FAIR: "University Campus Fair",
  SECTOR_FOCUSED_FAIR: "Sector-Focused Fair",
  PUBLIC_CAREER_FAIR: "Public Career Fair",
  NETWORKING: "Networking",
  MENTORING: "Mentoring",
  SKILLS_WORKSHOP: "Skills Workshop",
};

export const USER_TYPE_COPY: Record<UserType, { title: string; subtitle: string }> = {
  CANDIDATE: { title: "Candidate", subtitle: "Looking for a role" },
  EMPLOYER: { title: "Employer", subtitle: "Hiring at this fair" },
};

export const AUDIENCE_LABELS: Record<EventAudience, string> = {
  EVERYONE: "Open to all",
  CANDIDATES: "For candidates",
  EMPLOYERS: "For employers",
};

export const STATUS_LABELS: Record<EventStatus, string> = {
  UPCOMING: "Upcoming",
  FULL: "Full",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
  RESCHEDULED: "Rescheduled",
};

/** One row of `events`, with timestamps already parsed into `Date`. */
export interface EventRecord {
  id: string;
  slug: string;
  title: string;
  description: string;
  /** First day's start. */
  startAt: Date;
  /** FIRST day's end — the daily window, repeated on every day of the run. */
  endAt: Date;
  /** Last calendar day. Null for a single-day event. */
  lastDate: string | null;
  location: string;
  state: string;
  category: EventCategory;
  audience: EventAudience;
  status: EventStatus;
  capacity: number;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * An event plus its live registration count. `registeredCount` is always
 * computed by the database (`COUNT(registrations)`), never stored on the event
 * row — see the note in `availability.ts` for why.
 */
export interface EventWithAvailability extends EventRecord {
  registeredCount: number;
}

export interface RegistrationRecord {
  id: string;
  eventId: string;
  name: string;
  email: string;
  userType: UserType;
  createdAt: Date;
}

export const HISTORY_ACTIONS = [
  "CREATED",
  "UPDATED",
  "RESCHEDULED",
  "CANCELLED",
  "REOPENED",
  "MARKED_FULL",
  "COMPLETED",
] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

/** Whether a change was typed by a human or accepted from a Copilot proposal. */
export const CHANGE_SOURCES = ["MANUAL", "COPILOT"] as const;
export type ChangeSource = (typeof CHANGE_SOURCES)[number];

export interface EventHistoryRecord {
  id: string;
  eventId: string;
  action: HistoryAction;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  reason: string | null;
  changedBy: string;
  source: ChangeSource;
  createdAt: Date;
}
