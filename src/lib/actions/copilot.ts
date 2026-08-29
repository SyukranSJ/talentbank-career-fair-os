"use server";

import { requireAdmin } from "@/lib/auth";
import { getEventById, listEvents } from "@/lib/data/events";
import { buildScheduleSnapshot } from "@/lib/copilot/context";
import { interpretRequest } from "@/lib/copilot/interpret";
import {
  answerArgs,
  clarifyArgs,
  newEventArgs,
  rescheduleArgs,
  statusChangeArgs,
  suggestDatesArgs,
} from "@/lib/copilot/tools";
import { checkEventProposal, createEvent, setEventStatus, updateEvent } from "./events";
import type { ProposalCheck } from "./events";
import { isDateKey, isTimeKey, toDateKey, toTimeKey } from "@/lib/domain/time";
import { canTransition } from "@/lib/domain/availability";
import type { EventStatus } from "@/lib/domain/types";

/**
 * THE VALIDATION LAYER.
 *
 * This file is the reason the Copilot is safe to ship. It sits between a
 * language model and the database and treats everything coming out of the model
 * as hostile input, in this order:
 *
 *   1.  Is the caller an admin?!                        -> requireAdmin()
 *   2.  Build the snapshot from REAL rows              -> no invented data in
 *   3.  Ask the model to interpret                     -> interpretRequest()
 *   4.  Did it call a tool we actually defined?        -> tool name check
 *   5.  Do the arguments match our schema?             -> Zod re-parse
 *   6.  Does the event code map to a real event?       -> refToId lookup
 *   7.  Does that event still exist right now?         -> fresh DB read
 *   8.  Are the dates and times real?                  -> isDateKey/isTimeKey
 *   9.  Do the business rules pass? Any conflicts?     -> checkEventProposal()
 *   10. Show a preview and STOP.                       -> human decides
 *
 * Only after a human clicks Apply does `applyCopilotProposal` run — and that
 * calls exactly the same `createEvent` / `updateEvent` functions the manual
 * forms call, which validate everything a second time from scratch.
 */

export interface ProposedSlot {
  date: string;
  endDate: string | null;
  startTime: string;
  endTime: string;
  reason: string;
  check: ProposalCheck;
}

export type CopilotProposal =
  | {
      kind: "RESCHEDULE";
      eventId: string;
      eventTitle: string;
      current: { date: string; endDate: string | null; startTime: string; endTime: string };
      proposed: ProposedSlot;
    }
  | {
      kind: "CREATE";
      draft: {
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
        status: "UPCOMING";
      };
      reason: string;
      check: ProposalCheck;
    }
  | {
      kind: "STATUS";
      eventId: string;
      eventTitle: string;
      from: EventStatus;
      to: EventStatus;
      reason: string;
      registeredCount: number;
    }
  | {
      kind: "SUGGESTIONS";
      eventId: string;
      eventTitle: string;
      current: { date: string; startTime: string; endTime: string };
      options: ProposedSlot[];
    }
  | { kind: "ANSWER"; answer: string }
  | { kind: "CLARIFY"; question: string };

export interface CopilotResult {
  ok: boolean;
  /** Set when the pipeline rejected the model's output. Shown to the admin. */
  error?: string;
  /** Which validation step caught it — useful for the demo, and for debugging. */
  rejectedAt?: string;
  proposal?: CopilotProposal;
  confidence?: number;
  usage?: { input: number; output: number };
}

export async function askCopilot(message: string): Promise<CopilotResult> {
  await requireAdmin(); // step 1

  const trimmed = message.trim();
  if (trimmed.length < 3) {
    return { ok: false, error: "Type what you would like to do." };
  }
  if (trimmed.length > 1000) {
    return { ok: false, error: "That request is too long. Try something shorter and more specific." };
  }

  const now = new Date();
  const events = await listEvents(); // step 2 — real rows only
  const snapshot = buildScheduleSnapshot(events, now);

  const interpreted = await interpretRequest(trimmed, snapshot); // step 3
  if (!interpreted.ok) {
    return { ok: false, error: interpreted.error, rejectedAt: "Calling the model" };
  }

  const { tool, args, usage } = interpreted;

  /** Steps 6 + 7: a code the model used must map to an event that exists NOW. */
  async function resolveEvent(ref: string) {
    const id = snapshot.refToId.get(ref.trim().toUpperCase());
    if (!id) {
      return {
        error: `The Copilot referred to event "${ref}", which is not in the schedule. Nothing has been changed.`,
        step: "Resolving the event reference",
      } as const;
    }
    const event = await getEventById(id);
    if (!event) {
      return {
        error: "The event the Copilot referred to no longer exists. Nothing has been changed.",
        step: "Re-reading the event from the database",
      } as const;
    }
    return { event } as const;
  }

  /** Step 8: reject impossible dates before they reach the rules engine. */
  function checkSlotShape(date: string, endDate: string | null, start: string, end: string) {
    if (!isDateKey(date)) return `"${date}" is not a real calendar date.`;
    if (endDate !== null && !isDateKey(endDate)) return `"${endDate}" is not a real calendar date.`;
    if (!isTimeKey(start)) return `"${start}" is not a valid time.`;
    if (!isTimeKey(end)) return `"${end}" is not a valid time.`;
    return null;
  }

  switch (tool) {
    /* ------------------------------------------------------- reschedule --- */
    case "propose_reschedule": {
      const parsed = rescheduleArgs.safeParse(args); // step 5
      if (!parsed.success) {
        return { ok: false, error: schemaError(), rejectedAt: "Checking the proposal shape" };
      }

      const resolved = await resolveEvent(parsed.data.event_ref);
      if ("error" in resolved) {
        return { ok: false, error: resolved.error, rejectedAt: resolved.step };
      }

      const shapeError = checkSlotShape(
        parsed.data.new_date,
        parsed.data.new_end_date,
        parsed.data.new_start_time,
        parsed.data.new_end_time,
      );
      if (shapeError) {
        return {
          ok: false,
          error: `The Copilot proposed an invalid slot: ${shapeError} Nothing has been changed.`,
          rejectedAt: "Checking the proposed date and time",
        };
      }

      const event = resolved.event;
      const check = await checkEventProposal( // step 9
        {
          title: event.title,
          description: event.description,
          date: parsed.data.new_date,
          endDate: parsed.data.new_end_date ?? undefined,
          startTime: parsed.data.new_start_time,
          endTime: parsed.data.new_end_time,
          location: event.location,
          state: event.state,
          category: event.category,
          audience: event.audience,
          capacity: event.capacity,
          status: event.status,
        },
        event.id,
      );

      if (!check.ok) {
        return {
          ok: false,
          error: `The Copilot's proposal breaks a scheduling rule: ${check.errors.map((e) => e.message).join(" ")} Nothing has been changed.`,
          rejectedAt: "Applying the business rules",
        };
      }

      const startDate = toDateKey(event.startAt);

      return {
        ok: true,
        confidence: parsed.data.confidence,
        usage,
        proposal: {
          kind: "RESCHEDULE",
          eventId: event.id,
          eventTitle: event.title,
          current: {
            date: startDate,
            // endAt is only day one's end, so the last day comes from lastDate.
            endDate: event.lastDate,
            startTime: toTimeKey(event.startAt),
            endTime: toTimeKey(event.endAt),
          },
          proposed: {
            date: parsed.data.new_date,
            endDate: parsed.data.new_end_date,
            startTime: parsed.data.new_start_time,
            endTime: parsed.data.new_end_time,
            reason: parsed.data.reason,
            check,
          },
        },
      };
    }

    /* ----------------------------------------------------- create event --- */
    case "propose_new_event": {
      const parsed = newEventArgs.safeParse(args);
      if (!parsed.success) {
        return { ok: false, error: schemaError(), rejectedAt: "Checking the proposal shape" };
      }

      const shapeError = checkSlotShape(
        parsed.data.date,
        parsed.data.end_date,
        parsed.data.start_time,
        parsed.data.end_time,
      );
      if (shapeError) {
        return {
          ok: false,
          error: `The Copilot proposed an invalid slot: ${shapeError} Nothing has been created.`,
          rejectedAt: "Checking the proposed date and time",
        };
      }

      const draft = {
        title: parsed.data.title,
        description: parsed.data.description,
        date: parsed.data.date,
        endDate: parsed.data.end_date ?? undefined,
        startTime: parsed.data.start_time,
        endTime: parsed.data.end_time,
        location: parsed.data.location,
        state: parsed.data.state,
        category: parsed.data.category,
        audience: parsed.data.audience,
        capacity: parsed.data.capacity,
        status: "UPCOMING" as const,
      };

      const check = await checkEventProposal(draft);
      if (!check.ok) {
        return {
          ok: false,
          error: `The Copilot's draft is not valid: ${check.errors.map((e) => e.message).join(" ")}`,
          rejectedAt: "Applying the business rules",
        };
      }

      return {
        ok: true,
        confidence: parsed.data.confidence,
        usage,
        proposal: { kind: "CREATE", draft, reason: parsed.data.reason, check },
      };
    }

    /* --------------------------------------------------- status change --- */
    case "propose_status_change": {
      const parsed = statusChangeArgs.safeParse(args);
      if (!parsed.success) {
        return { ok: false, error: schemaError(), rejectedAt: "Checking the proposal shape" };
      }

      const resolved = await resolveEvent(parsed.data.event_ref);
      if ("error" in resolved) {
        return { ok: false, error: resolved.error, rejectedAt: resolved.step };
      }

      const event = resolved.event;
      if (!canTransition(event.status, parsed.data.status)) {
        return {
          ok: false,
          error: `The Copilot suggested moving "${event.title}" from ${event.status} to ${parsed.data.status}, which is not a permitted change. Nothing has been changed.`,
          rejectedAt: "Checking the status transition",
        };
      }

      return {
        ok: true,
        confidence: parsed.data.confidence,
        usage,
        proposal: {
          kind: "STATUS",
          eventId: event.id,
          eventTitle: event.title,
          from: event.status,
          to: parsed.data.status,
          reason: parsed.data.reason,
          registeredCount: event.registeredCount,
        },
      };
    }

    /* ------------------------------------------------- suggest a better --- */
    case "suggest_dates": {
      const parsed = suggestDatesArgs.safeParse(args);
      if (!parsed.success) {
        return { ok: false, error: schemaError(), rejectedAt: "Checking the proposal shape" };
      }

      const resolved = await resolveEvent(parsed.data.event_ref);
      if ("error" in resolved) {
        return { ok: false, error: resolved.error, rejectedAt: resolved.step };
      }
      const event = resolved.event;

      // Every suggested slot is independently validated against live data.
      // A suggestion the rules reject is dropped rather than shown, because
      // offering an admin a button that cannot work is worse than offering
      // fewer options.
      const options: ProposedSlot[] = [];
      for (const option of parsed.data.options) {
        if (checkSlotShape(option.date, option.end_date, option.start_time, option.end_time)) {
          continue;
        }
        const check = await checkEventProposal(
          {
            title: event.title,
            description: event.description,
            date: option.date,
            endDate: option.end_date ?? undefined,
            startTime: option.start_time,
            endTime: option.end_time,
            location: event.location,
            state: event.state,
            category: event.category,
            audience: event.audience,
            capacity: event.capacity,
            status: event.status,
          },
          event.id,
        );
        if (!check.ok) continue;
        options.push({
          date: option.date,
          endDate: option.end_date,
          startTime: option.start_time,
          endTime: option.end_time,
          reason: option.reason,
          check,
        });
      }

      if (options.length === 0) {
        return {
          ok: false,
          error:
            "None of the Copilot's suggestions passed validation, so none are shown. Try asking again with a narrower window.",
          rejectedAt: "Applying the business rules",
        };
      }

      return {
        ok: true,
        confidence: parsed.data.confidence,
        usage,
        proposal: {
          kind: "SUGGESTIONS",
          eventId: event.id,
          eventTitle: event.title,
          current: {
            date: toDateKey(event.startAt),
            startTime: toTimeKey(event.startAt),
            endTime: toTimeKey(event.endAt),
          },
          options,
        },
      };
    }

    /* ------------------------------------------------------ read-only --- */
    case "answer_question": {
      const parsed = answerArgs.safeParse(args);
      if (!parsed.success) {
        return { ok: false, error: schemaError(), rejectedAt: "Checking the proposal shape" };
      }
      return { ok: true, usage, proposal: { kind: "ANSWER", answer: parsed.data.answer } };
    }

    case "ask_for_clarification": {
      const parsed = clarifyArgs.safeParse(args);
      if (!parsed.success) {
        return { ok: false, error: schemaError(), rejectedAt: "Checking the proposal shape" };
      }
      return { ok: true, usage, proposal: { kind: "CLARIFY", question: parsed.data.question } };
    }

    default:
      // Step 4. Should be impossible — the API only offers our tools — but if
      // it ever happens we refuse rather than guess.
      return {
        ok: false,
        error: `The Copilot tried to use an unknown action ("${tool}"). Nothing has been changed.`,
        rejectedAt: "Checking the action type",
      };
  }
}

function schemaError() {
  return "The Copilot returned an action that did not match the expected format, so it was rejected. Nothing has been changed.";
}

/* -------------------------------------------------------------------------- *
 * Applying an approved proposal.
 *
 * Note what this does NOT do: it does not take the client's word for anything.
 * It calls the same mutation functions the manual admin forms call, which
 * re-check the admin session, re-validate every field, and re-run conflict
 * detection against data as it is at this moment — not as it was when the
 * preview was generated. If someone else moved an event in the meantime, the
 * apply fails safely instead of overwriting their change blindly.
 * -------------------------------------------------------------------------- */

export async function applyCopilotProposal(
  proposal: CopilotProposal,
  acknowledgeConflicts: boolean,
) {
  await requireAdmin();

  switch (proposal.kind) {
    case "RESCHEDULE": {
      const event = await getEventById(proposal.eventId);
      if (!event) return { ok: false, message: "That event no longer exists." };

      return updateEvent(
        proposal.eventId,
        {
          title: event.title,
          description: event.description,
          date: proposal.proposed.date,
          endDate: proposal.proposed.endDate ?? undefined,
          startTime: proposal.proposed.startTime,
          endTime: proposal.proposed.endTime,
          location: event.location,
          state: event.state,
          category: event.category,
          audience: event.audience,
          capacity: event.capacity,
          status: event.status === "UPCOMING" ? "RESCHEDULED" : event.status,
        },
        {
          acknowledgeConflicts,
          reason: `Event Copilot: ${proposal.proposed.reason}`,
          source: "COPILOT",
        },
      );
    }

    case "CREATE":
      return createEvent(proposal.draft, {
        acknowledgeConflicts,
        reason: `Event Copilot: ${proposal.reason}`,
        source: "COPILOT",
      });

    case "STATUS":
      return setEventStatus(proposal.eventId, proposal.to, proposal.reason, {
        source: "COPILOT",
      });

    default:
      return { ok: false, message: "This suggestion is informational and cannot be applied." };
  }
}
