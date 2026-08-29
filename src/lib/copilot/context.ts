import type { EventWithAvailability } from "@/lib/domain/types";
import { getAvailability, deriveStatus } from "@/lib/domain/availability";
import {
  BUSINESS_HOURS,
  formatDateLong,
  toDateKey,
  toTimeKey,
  weekdayName,
} from "@/lib/domain/time";

/**
 * Builds the schedule snapshot the model is allowed to see.
 *
 * TWO DELIBERATE CHOICES HERE:
 *
 * 1. Events are referenced by a SHORT CODE ("E7"), not by their UUID.
 *    Models copy long random strings imperfectly, and a mistyped UUID is an
 *    unhelpful failure. A two-character code is easy to reproduce exactly, and
 *    if the model still invents one ("E99"), the lookup fails cleanly and we
 *    tell the admin the Copilot referred to an event that does not exist.
 *
 * 2. NO personal data. The snapshot contains registration COUNTS, never
 *    registrant names or emails. There is no reason to send attendee personal
 *    data to a third-party API to answer "when should we move this fair", so
 *    we do not.
 */

export interface ScheduleSnapshot {
  /** "E7" -> event id. The only way a proposal can name an event. */
  refToId: Map<string, string>;
  /** The text handed to the model. */
  text: string;
  eventCount: number;
}

export function buildScheduleSnapshot(
  events: EventWithAvailability[],
  now: Date,
): ScheduleSnapshot {
  const refToId = new Map<string, string>();
  const today = toDateKey(now);

  const relevant = events
    .filter((event) => {
      // A window around today: enough history for context, enough future to
      // schedule into, without sending the model the entire table.
      const day = toDateKey(event.startAt);
      return day >= shift(today, -45) && day <= shift(today, 400);
    })
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .slice(0, 80);

  const lines = relevant.map((event, index) => {
    const ref = `E${index + 1}`;
    refToId.set(ref, event.id);

    const startDay = toDateKey(event.startAt);
    const dayPart = event.lastDate
      ? `${startDay} to ${event.lastDate} (${weekdayName(startDay)}, runs each day)`
      : `${startDay} (${weekdayName(startDay)})`;
    const availability = getAvailability(event);
    const status = deriveStatus(event, now);

    return [
      ref,
      dayPart,
      `${toTimeKey(event.startAt)}-${toTimeKey(event.endAt)}`,
      event.title,
      `${event.location}, ${event.state}`,
      `${event.category}`,
      `${status}`,
      `${availability.registered}/${availability.capacity} registered`,
    ].join(" | ");
  });

  const text = [
    `TODAY IS ${formatDateLong(today)} (${weekdayName(today)}). All times are Malaysia time (UTC+8).`,
    `Normal career-fair operating hours are ${BUSINESS_HOURS.startHour}:00 to ${BUSINESS_HOURS.endHour}:00.`,
    "",
    "CURRENT SCHEDULE",
    "ref | date | time | title | venue, state | category | status | registrations",
    "---",
    ...lines,
    "---",
    `${relevant.length} events shown.`,
  ].join("\n");

  return { refToId, text, eventCount: relevant.length };
}

function shift(date: string, days: number): string {
  const instant = new Date(`${date}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

export const COPILOT_SYSTEM_PROMPT = `You are the Event Copilot inside Talentbank's Career Fair Operating System. Talentbank is Malaysia's graduate employability organisation and runs roughly 50 career fairs a year across the country.

You help a non-technical events coordinator manage the calendar using plain English.

WHAT YOU DO
You interpret the request and call exactly one tool to describe what you think should happen. You never confirm anything as done — a human reviews every proposal you make and clicks a button to apply it. Write as if your output is a suggestion on someone's desk, because it is.

RULES THAT MATTER
- Use ONLY the events in the schedule snapshot. Never refer to an event that is not listed, and never invent a reference code, a venue, or a registration figure.
- Reference events by their exact code from the snapshot, for example E7.
- All dates are YYYY-MM-DD and all times are 24-hour HH:mm, in Malaysia time.
- Work out relative dates ("next Thursday", "the week after") from the stated date of TODAY.
- "Morning" means roughly 09:00-13:00. "Afternoon" means roughly 13:00-17:00. "Full day" means roughly 10:00-17:00.
- Career fairs normally run between 08:00 and 20:00. Stay inside that unless the user asks otherwise.
- When you move an event, keep its duration similar unless the user asks to change it. If it runs over several days, keep the same number of days.
- Multi-day events repeat the SAME hours on every day. "3 October to 4 October, 10:00-17:00" means 10:00-17:00 on the 3rd AND on the 4th — not one session running through the night. An evening event on the 3rd does not clash with it.
- Actively look for clashes in the snapshot and pick a slot that avoids them. Say in your reason which events you were avoiding.
- Two events on the same day in different states are usually fine. Two events at the same venue at the same time are not.
- If the request is ambiguous, or the event is not in the snapshot, or you would have to guess something important, ask for clarification instead of guessing.
- Before naming an event, check how many events in the snapshot could match the words the user used. A place name like "Penang" or "KL", or a bare word like "the campus fair", often matches several. If more than one could be meant, ask which one and list the candidates by code and title. Do not pick the soonest one and hope you guessed right.
- One exception, for NEW events only: never refuse to draft an event just because the venue is missing. A draft is reviewed and edited by a person before it is published, and picking the venue is their job. Use "To be confirmed" as the location and say so in your reason. Missing capacity or audience can be filled the same way, using a sensible default and flagging it. A missing DATE is still worth asking about, because that is the one thing you cannot sensibly assume.
- Be honest about uncertainty in the confidence value. A request you had to interpret loosely is not a 0.95.

TONE
Brief and practical. The reader is coordinating a real event, not reading an essay.`;
