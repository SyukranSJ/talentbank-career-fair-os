/**
 * Business-rule tests. These deliberately need no database, no network and no
 * React — that is the payoff of keeping `src/lib/domain` pure.
 *
 * Run with: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  addDays,
  eventDates,
  eventFinishesAt,
  eventOccurrences,
  formatDailyHours,
  formatDayRange,
  isMultiDay,
  formatEventSchedule,
  formatTime12h,
  fromKL,
  isDateKey,
  monthGrid,
  shiftMonth,
  toDateKey,
  toTimeKey,
  relativeDayLabel,
  weekdayName,
} from "../src/lib/domain/time";
import {
  allowedTransitions,
  allowedUserTypes,
  audienceRestrictionMessage,
  isUserTypeAllowed,
  canTransition,
  deriveStatus,
  getAvailability,
  isRegistrationOpen,
  registrationClosedReason,
} from "../src/lib/domain/availability";
import {
  canApplyChange,
  findConflicts,
  highestSeverity,
  overlaps,
  requiresAcknowledgement,
} from "../src/lib/domain/conflicts";
import { validateEventInput, validateRegistrationInput, slugify } from "../src/lib/domain/rules";
import { EVENT_AUDIENCES, type EventWithAvailability } from "../src/lib/domain/types";

/* ---------------------------------------------------------------- time --- */

test("Malaysian wall-clock time converts to the correct UTC instant", () => {
  // 10:00 in Kuala Lumpur is 02:00 UTC.
  assert.equal(fromKL("2026-09-18", "10:00").toISOString(), "2026-09-18T02:00:00.000Z");
  // And back again.
  assert.equal(toDateKey(fromKL("2026-09-18", "10:00")), "2026-09-18");
  assert.equal(toTimeKey(fromKL("2026-09-18", "10:00")), "10:00");
});

test("an evening event does not slip into the previous UTC day when read back", () => {
  // 01:00 KL is 17:00 UTC the *previous* day. Reading UTC fields naively here
  // is the classic bug; toDateKey must still say 19 September.
  const instant = fromKL("2026-09-19", "01:00");
  assert.equal(instant.toISOString(), "2026-09-18T17:00:00.000Z");
  assert.equal(toDateKey(instant), "2026-09-19");
});

test("invalid dates are rejected rather than silently rolled over", () => {
  assert.equal(isDateKey("2026-02-30"), false);
  assert.equal(isDateKey("2026-13-01"), false);
  assert.equal(isDateKey("2026-02-28"), true);
  assert.throws(() => fromKL("2026-02-30", "10:00"));
  assert.throws(() => fromKL("2026-09-18", "25:00"));
});

test("times render in the Malaysian 12-hour convention", () => {
  assert.equal(formatTime12h("10:00"), "10:00 AM");
  assert.equal(formatTime12h("17:00"), "5:00 PM");
  assert.equal(formatTime12h("00:30"), "12:30 AM");
  assert.equal(formatTime12h("12:00"), "12:00 PM");
});

test("a single-day event reads as one date and one time range", () => {
  assert.equal(
    formatEventSchedule(fromKL("2026-09-18", "10:00"), fromKL("2026-09-18", "17:00"), null),
    "18 September 2026 · 10:00 AM – 5:00 PM",
  );
});

test("a two-day fair reads as a day range with daily hours", () => {
  // The brief's example: 1-2 October, 10 AM - 5 PM EACH DAY. It must not read
  // as one continuous 31-hour session.
  const start = fromKL("2026-10-01", "10:00");
  const end = fromKL("2026-10-01", "17:00"); // FIRST day's end
  assert.equal(
    formatEventSchedule(start, end, "2026-10-02"),
    "1–2 October 2026 · 10:00 AM – 5:00 PM each day",
  );
  assert.equal(formatDayRange("2026-10-01", "2026-10-02"), "1–2 October 2026");
  assert.equal(formatDailyHours(start, end, "2026-10-02"), "10:00 AM – 5:00 PM each day");
  assert.equal(formatDailyHours(start, end, null), "10:00 AM – 5:00 PM", "no 'each day' for one day");
});

test("day ranges collapse only the parts that actually repeat", () => {
  assert.equal(formatDayRange("2026-10-30", "2026-11-01"), "30 October – 1 November 2026");
  assert.equal(formatDayRange("2026-12-31", "2027-01-01"), "31 December 2026 – 1 January 2027");
  assert.equal(formatDayRange("2026-10-01", null), "1 October 2026");
});

test("a two-day fair occupies both calendar cells", () => {
  assert.deepEqual(eventDates(fromKL("2026-10-01", "10:00"), "2026-10-02"), [
    "2026-10-01",
    "2026-10-02",
  ]);
  assert.deepEqual(eventDates(fromKL("2026-10-01", "10:00"), null), ["2026-10-01"]);
});

test("a multi-day event is a sitting per day, not one long block", () => {
  const days = eventOccurrences(
    fromKL("2026-10-01", "10:00"),
    fromKL("2026-10-01", "17:00"),
    "2026-10-02",
  );
  assert.equal(days.length, 2);
  assert.equal(days[0].start.toISOString(), "2026-10-01T02:00:00.000Z");
  assert.equal(days[0].end.toISOString(), "2026-10-01T09:00:00.000Z");
  assert.equal(days[1].start.toISOString(), "2026-10-02T02:00:00.000Z");
  assert.equal(days[1].end.toISOString(), "2026-10-02T09:00:00.000Z");

  const hours = (days[0].end.getTime() - days[0].start.getTime()) / 3_600_000;
  assert.equal(hours, 7, "each sitting is 7 hours, not a 31-hour marathon");
});

test("a multi-day event finishes at the end of its LAST day", () => {
  const finish = eventFinishesAt(
    fromKL("2026-10-01", "10:00"),
    fromKL("2026-10-01", "17:00"),
    "2026-10-02",
  );
  assert.equal(finish.toISOString(), fromKL("2026-10-02", "17:00").toISOString());
  assert.equal(isMultiDay(fromKL("2026-10-01", "10:00"), "2026-10-02"), true);
  assert.equal(isMultiDay(fromKL("2026-10-01", "10:00"), null), false);
});

test("a two-day fair is still upcoming on the morning of day two", () => {
  const event = baseEvent({
    startAt: fromKL("2026-10-01", "10:00"),
    endAt: fromKL("2026-10-01", "17:00"),
    lastDate: "2026-10-02",
  });
  const dayTwoMorning = fromKL("2026-10-02", "09:00");
  assert.equal(deriveStatus(event, dayTwoMorning), "UPCOMING");
  assert.equal(isRegistrationOpen(event, dayTwoMorning), true);

  const afterItEnds = fromKL("2026-10-02", "18:00");
  assert.equal(deriveStatus(event, afterItEnds), "COMPLETED");
});

test("the month grid is Monday-first and always 6 weeks", () => {
  const grid = monthGrid(2026, 9); // 1 Sep 2026 is a Tuesday
  assert.equal(grid.length, 42);
  assert.equal(weekdayName(grid[0]), "Monday");
  assert.equal(grid[0], "2026-08-31");
  assert.ok(grid.includes("2026-09-01"));
  assert.ok(grid.includes("2026-09-30"));
});

test("month navigation crosses year boundaries in both directions", () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth(2026, 6, 7), { year: 2027, month: 1 });
});

test("date arithmetic does not drift across month ends", () => {
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("a relative day label is only produced when it actually helps", () => {
  const today = "2026-08-29";
  assert.equal(relativeDayLabel("2026-08-29", today), "Today");
  assert.equal(relativeDayLabel("2026-08-30", today), "Tomorrow");
  assert.equal(relativeDayLabel("2026-08-28", today), "Yesterday");
  assert.equal(relativeDayLabel("2026-09-02", today), "In 4 days");
  assert.equal(relativeDayLabel("2026-09-12", today), "In 2 weeks");
  assert.equal(relativeDayLabel("2026-08-19", today), "10 days ago");

  // Beyond the useful window it must return null rather than a short date.
  // It is always rendered next to the full date, so a date fallback printed
  // the same day twice: "21 November 2026 ... Saturday - 21 Nov 2026".
  assert.equal(relativeDayLabel("2026-11-21", today), null);
  assert.equal(relativeDayLabel("2027-06-19", today), null);
  assert.equal(relativeDayLabel("2026-07-09", today), null, "far past is also null");
});

/* -------------------------------------------------------- availability --- */

const baseEvent = (over: Partial<EventWithAvailability> = {}): EventWithAvailability => ({
  id: "e1",
  slug: "tech-career-fair",
  title: "Technology Career Fair",
  description: "",
  startAt: fromKL("2026-09-18", "10:00"),
  endAt: fromKL("2026-09-18", "17:00"),
  location: "Kuala Lumpur Convention Centre",
  state: "Kuala Lumpur",
  category: "SECTOR_FOCUSED_FAIR",
  audience: "EVERYONE",
  status: "UPCOMING",
  capacity: 200,
  lastDate: null,
  cancellationReason: null,
  registeredCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const NOW = fromKL("2026-08-29", "12:00");

test("remaining places never go negative even if capacity is lowered", () => {
  const a = getAvailability(baseEvent({ capacity: 100, registeredCount: 83 }));
  assert.equal(a.remaining, 17);
  assert.equal(a.percentFull, 83);
  assert.equal(a.isAtCapacity, false);

  // The team cut capacity to 50 after 83 people already signed up.
  const shrunk = getAvailability(baseEvent({ capacity: 50, registeredCount: 83 }));
  assert.equal(shrunk.remaining, 0);
  assert.equal(shrunk.isAtCapacity, true);
  assert.equal(shrunk.percentFull, 100, "percentage is clamped, not 166%");
});

test("an event at capacity shows as FULL without anyone flipping a switch", () => {
  const event = baseEvent({ capacity: 200, registeredCount: 200 });
  assert.equal(deriveStatus(event, NOW), "FULL");
  assert.equal(isRegistrationOpen(event, NOW), false);
});

test("cancellation outranks every other signal", () => {
  const event = baseEvent({ status: "CANCELLED", capacity: 200, registeredCount: 200 });
  assert.equal(deriveStatus(event, NOW), "CANCELLED");
  assert.match(registrationClosedReason(event, NOW) ?? "", /cancelled/i);
});

test("a past event reads as completed even if nobody tidied up the status", () => {
  const event = baseEvent({
    status: "UPCOMING",
    startAt: fromKL("2026-07-10", "10:00"),
    endAt: fromKL("2026-07-10", "17:00"),
  });
  assert.equal(deriveStatus(event, NOW), "COMPLETED");
  assert.equal(isRegistrationOpen(event, NOW), false);
});

test("a rescheduled event still accepts registrations", () => {
  const event = baseEvent({ status: "RESCHEDULED" });
  assert.equal(deriveStatus(event, NOW), "RESCHEDULED");
  assert.equal(isRegistrationOpen(event, NOW), true);
});

test("status transitions block the nonsensical ones", () => {
  assert.equal(canTransition("UPCOMING", "CANCELLED"), true);
  assert.equal(canTransition("CANCELLED", "UPCOMING"), true, "a cancellation can be reversed");
  assert.equal(canTransition("CANCELLED", "FULL"), false, "but not straight to full");
  assert.equal(canTransition("COMPLETED", "UPCOMING"), false, "completed is terminal");
  assert.deepEqual(allowedTransitions("COMPLETED"), []);
});

/* ------------------------------------------------------------- audience --- */

test("an event open to all accepts both roles", () => {
  assert.deepEqual(allowedUserTypes("EVERYONE"), ["CANDIDATE", "EMPLOYER"]);
  assert.equal(isUserTypeAllowed("EVERYONE", "CANDIDATE"), true);
  assert.equal(isUserTypeAllowed("EVERYONE", "EMPLOYER"), true);
  assert.equal(audienceRestrictionMessage("EVERYONE"), null, "nothing to explain");
});

test("a candidates-only event refuses employers", () => {
  assert.deepEqual(allowedUserTypes("CANDIDATES"), ["CANDIDATE"]);
  assert.equal(isUserTypeAllowed("CANDIDATES", "CANDIDATE"), true);
  assert.equal(
    isUserTypeAllowed("CANDIDATES", "EMPLOYER"),
    false,
    "the form used to offer Employer here regardless",
  );
  assert.equal(audienceRestrictionMessage("CANDIDATES"), "This event is for candidates only.");
});

test("an employers-only event refuses candidates", () => {
  assert.deepEqual(allowedUserTypes("EMPLOYERS"), ["EMPLOYER"]);
  assert.equal(isUserTypeAllowed("EMPLOYERS", "EMPLOYER"), true);
  assert.equal(isUserTypeAllowed("EMPLOYERS", "CANDIDATE"), false);
  assert.equal(audienceRestrictionMessage("EMPLOYERS"), "This event is for employers only.");
});

test("every audience permits at least one role", () => {
  // A guard against a future audience value that silently blocks everyone.
  for (const audience of EVENT_AUDIENCES) {
    assert.ok(
      allowedUserTypes(audience).length >= 1,
      `${audience} would accept nobody`,
    );
  }
});

test("the audience rule is independent of whether registration is open", () => {
  // A cancelled candidates-only event still describes candidates as its
  // audience; the two checks answer different questions and must not be
  // collapsed into one.
  assert.equal(isUserTypeAllowed("CANDIDATES", "CANDIDATE"), true);
  const cancelled = baseEvent({ status: "CANCELLED", audience: "CANDIDATES" });
  assert.equal(isRegistrationOpen(cancelled, NOW), false);
  assert.equal(isUserTypeAllowed(cancelled.audience, "CANDIDATE"), true);
});

/* ----------------------------------------------------------- conflicts --- */

test("back-to-back events do not count as overlapping", () => {
  const overlap = overlaps(
    fromKL("2026-09-18", "10:00"),
    fromKL("2026-09-18", "13:00"),
    fromKL("2026-09-18", "13:00"),
    fromKL("2026-09-18", "17:00"),
  );
  assert.equal(overlap, false, "an event ending exactly when another starts is fine");
});

const candidate = (over: Partial<Parameters<typeof findConflicts>[1][number]> = {}) => ({
  id: "other",
  slug: "other",
  title: "Technology Career Fair",
  location: "Kuala Lumpur Convention Centre",
  state: "Kuala Lumpur",
  startAt: fromKL("2026-09-18", "10:00"),
  endAt: fromKL("2026-09-18", "15:00"),
  lastDate: null as string | null,
  status: "UPCOMING" as const,
  ...over,
});

test("the brief's example overlap is detected", () => {
  // Existing 10:00-15:00, new 13:00-17:00.
  const conflicts = findConflicts(
    {
      startAt: fromKL("2026-09-18", "13:00"),
      endAt: fromKL("2026-09-18", "17:00"),
      location: "Kuala Lumpur Convention Centre",
      state: "Kuala Lumpur",
    },
    [candidate()],
  );
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].severity, "HIGH", "same venue, overlapping hours");
});

test("conflicts are graded by how much they actually hurt", () => {
  const slot = {
    startAt: fromKL("2026-09-18", "13:00"),
    endAt: fromKL("2026-09-18", "17:00"),
    location: "Mid Valley Exhibition Centre",
    state: "Kuala Lumpur",
  };
  const sameState = findConflicts(slot, [candidate()]);
  assert.equal(sameState[0].severity, "MEDIUM", "different venue, same state");

  const otherState = findConflicts(slot, [
    candidate({ location: "SPICE Arena", state: "Penang" }),
  ]);
  assert.equal(otherState[0].severity, "LOW", "parallel events in another state are normal");
});

test("an event never conflicts with itself when it is being moved", () => {
  const conflicts = findConflicts(
    {
      eventId: "other",
      startAt: fromKL("2026-09-18", "10:00"),
      endAt: fromKL("2026-09-18", "15:00"),
      location: "Kuala Lumpur Convention Centre",
      state: "Kuala Lumpur",
    },
    [candidate()],
  );
  assert.deepEqual(conflicts, [], "moving an event must not flag the row being moved");
});

test("a multi-day fair does not occupy the evening between its days", () => {
  // THE BUG THIS LOCKS DOWN: stored as one interval from day one's opening to
  // day two's closing, a two-day fair "occupied" the venue overnight, and an
  // evening event on night one was reported as a HIGH venue clash.
  const twoDayFair = candidate({
    id: "fair",
    title: "Talentbank Tech Career Fair",
    location: "Mid Valley Exhibition Centre",
    startAt: fromKL("2026-10-03", "10:00"),
    endAt: fromKL("2026-10-03", "18:00"), // FIRST day's end
    lastDate: "2026-10-04",
  });

  const slot = { location: "Mid Valley Exhibition Centre", state: "Kuala Lumpur" };

  // Evening of night one — the fair shut at 18:00.
  assert.deepEqual(
    findConflicts(
      { ...slot, startAt: fromKL("2026-10-03", "19:30"), endAt: fromKL("2026-10-03", "22:00") },
      [twoDayFair],
    ),
    [],
    "an evening event after closing is not a clash",
  );

  // Early on day two — the fair opens at 10:00.
  assert.deepEqual(
    findConflicts(
      { ...slot, startAt: fromKL("2026-10-04", "07:00"), endAt: fromKL("2026-10-04", "09:00") },
      [twoDayFair],
    ),
    [],
    "a breakfast briefing before opening is not a clash",
  );

  // During opening hours on day two — this one is real.
  const real = findConflicts(
    { ...slot, startAt: fromKL("2026-10-04", "13:00"), endAt: fromKL("2026-10-04", "15:00") },
    [twoDayFair],
  );
  assert.equal(real.length, 1, "a genuine clash on day two is still detected");
  assert.equal(real[0].severity, "HIGH");

  // And on day one.
  assert.equal(
    findConflicts(
      { ...slot, startAt: fromKL("2026-10-03", "11:00"), endAt: fromKL("2026-10-03", "12:00") },
      [twoDayFair],
    ).length,
    1,
    "a genuine clash on day one is still detected",
  );
});

test("two multi-day fairs clash only on the days they share", () => {
  const octFair = candidate({
    id: "a",
    startAt: fromKL("2026-10-03", "10:00"),
    endAt: fromKL("2026-10-03", "18:00"),
    lastDate: "2026-10-04",
    location: "Mid Valley Exhibition Centre",
  });

  // Overlapping run, same venue -> clash.
  assert.equal(
    findConflicts(
      {
        startAt: fromKL("2026-10-04", "10:00"),
        endAt: fromKL("2026-10-04", "18:00"),
        lastDate: "2026-10-05",
        location: "Mid Valley Exhibition Centre",
        state: "Kuala Lumpur",
      },
      [octFair],
    ).length,
    1,
  );

  // Runs that merely sit next to each other share no day.
  assert.deepEqual(
    findConflicts(
      {
        startAt: fromKL("2026-10-05", "10:00"),
        endAt: fromKL("2026-10-05", "18:00"),
        lastDate: "2026-10-06",
        location: "Mid Valley Exhibition Centre",
        state: "Kuala Lumpur",
      },
      [octFair],
    ),
    [],
  );
});

test("cancelled events free up their slot", () => {
  const conflicts = findConflicts(
    {
      startAt: fromKL("2026-09-18", "13:00"),
      endAt: fromKL("2026-09-18", "17:00"),
      location: "Kuala Lumpur Convention Centre",
      state: "Kuala Lumpur",
    },
    [candidate({ status: "CANCELLED" })],
  );
  assert.deepEqual(conflicts, []);
  assert.equal(highestSeverity(conflicts), null);
});

test("a clash-free change needs no acknowledgement", () => {
  assert.equal(requiresAcknowledgement([]), false);
  assert.equal(canApplyChange([], false), true, "nothing to acknowledge, so allow it");
});

test("a clashing change is blocked until it is acknowledged", () => {
  const conflicts = findConflicts(
    {
      startAt: fromKL("2026-09-18", "13:00"),
      endAt: fromKL("2026-09-18", "17:00"),
      location: "Kuala Lumpur Convention Centre",
      state: "Kuala Lumpur",
    },
    [candidate()],
  );
  assert.equal(conflicts.length, 1);
  assert.equal(requiresAcknowledgement(conflicts), true);
  assert.equal(canApplyChange(conflicts, false), false, "not acknowledged yet");
  assert.equal(canApplyChange(conflicts, true), true, "admin has confirmed");
});

test("even the mildest clash needs acknowledging", () => {
  // A LOW conflict is two events in different states. Usually fine — but
  // "usually fine" is the events team's call, not this function's, so the gate
  // is deliberately severity-independent.
  const low = findConflicts(
    {
      startAt: fromKL("2026-09-18", "13:00"),
      endAt: fromKL("2026-09-18", "17:00"),
      location: "SPICE Arena",
      state: "Penang",
    },
    [candidate()],
  );
  assert.equal(low[0].severity, "LOW");
  assert.equal(canApplyChange(low, false), false);
  assert.equal(canApplyChange(low, true), true);
});

test("each suggested slot is gated on its own conflicts", () => {
  // The Copilot returns up to three slots. Acknowledging the recommended one
  // must not authorise a different alternative that clashes — which is exactly
  // the bug a single panel-level checkbox would reintroduce.
  const clean = findConflicts(
    {
      startAt: fromKL("2026-09-30", "10:00"),
      endAt: fromKL("2026-09-30", "13:00"),
      location: "Kuala Lumpur Convention Centre",
      state: "Kuala Lumpur",
    },
    [candidate()],
  );
  const clashing = findConflicts(
    {
      startAt: fromKL("2026-09-18", "13:00"),
      endAt: fromKL("2026-09-18", "17:00"),
      location: "Kuala Lumpur Convention Centre",
      state: "Kuala Lumpur",
    },
    [candidate()],
  );

  assert.deepEqual(clean, []);
  assert.equal(canApplyChange(clean, false), true, "the clean slot applies immediately");
  assert.equal(
    canApplyChange(clashing, false),
    false,
    "the clashing slot stays blocked regardless of the other card",
  );
});

/* --------------------------------------------------------------- rules --- */

const validEvent = {
  title: "Graduate Career Fair",
  description: "For final-year students and employers.",
  date: "2026-10-15",
  startTime: "10:00",
  endTime: "16:00",
  location: "Kuala Lumpur Convention Centre",
  state: "Kuala Lumpur",
  category: "PUBLIC_CAREER_FAIR",
  audience: "EVERYONE",
  capacity: 300,
  status: "UPCOMING",
};

test("a well-formed event passes and produces the right instants", () => {
  const result = validateEventInput(validEvent, NOW);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.times.startAt.toISOString(), "2026-10-15T02:00:00.000Z");
  assert.equal(result.times.endAt.toISOString(), "2026-10-15T08:00:00.000Z");
  assert.deepEqual(result.warnings, []);
});

test("an event that ends before it starts is rejected", () => {
  const result = validateEventInput({ ...validEvent, startTime: "16:00", endTime: "10:00" }, NOW);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.errors[0].message, /finish after it starts/);
});

test("odd hours warn but do not block", () => {
  const result = validateEventInput({ ...validEvent, startTime: "05:00", endTime: "07:00" }, NOW);
  assert.equal(result.ok, true, "the team is allowed to schedule an unusual event");
  if (!result.ok) return;
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0].message, /normally run between/);
});

test("capacity must be a sensible whole number", () => {
  assert.equal(validateEventInput({ ...validEvent, capacity: 0 }, NOW).ok, false);
  assert.equal(validateEventInput({ ...validEvent, capacity: -5 }, NOW).ok, false);
  assert.equal(validateEventInput({ ...validEvent, capacity: 2.5 }, NOW).ok, false);
  assert.equal(validateEventInput({ ...validEvent, capacity: "300" }, NOW).ok, true, "form posts strings");
});

test("registration input catches the common mistakes", () => {
  assert.equal(
    validateRegistrationInput({ name: "Aisyah Rahman", email: "aisyah@example.com", userType: "CANDIDATE" }).ok,
    true,
  );
  assert.equal(validateRegistrationInput({ name: "A", email: "a@b.com", userType: "CANDIDATE" }).ok, false);
  assert.equal(
    validateRegistrationInput({ name: "Aisyah Rahman", email: "not-an-email", userType: "CANDIDATE" }).ok,
    false,
  );
  assert.equal(
    validateRegistrationInput({ name: "Aisyah Rahman", email: "a@b", userType: "CANDIDATE" }).ok,
    false,
    "a domain with no dot is not a real address",
  );
  assert.equal(
    validateRegistrationInput({ name: "Aisyah Rahman", email: "a@b.com", userType: "ROBOT" }).ok,
    false,
  );
});

test("emails are normalised so duplicate detection actually works", () => {
  const result = validateRegistrationInput({
    name: "  Aisyah Rahman ",
    email: "  Aisyah@Example.COM ",
    userType: "EMPLOYER",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.email, "aisyah@example.com");
  assert.equal(result.value.name, "Aisyah Rahman");
});

test("slugs are URL-safe", () => {
  assert.equal(slugify("Talentbank Tech Career Fair 2026"), "talentbank-tech-career-fair-2026");
  assert.equal(slugify("Universiti Sains  Islam — Career Fair!"), "universiti-sains-islam-career-fair");
});
