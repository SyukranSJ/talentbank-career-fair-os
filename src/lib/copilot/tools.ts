import { Type, type FunctionDeclaration, type Schema } from "@google/genai";
import { z } from "zod";
import {
  EVENT_AUDIENCES,
  EVENT_CATEGORIES,
  EVENT_STATUSES,
  MALAYSIAN_STATES,
} from "@/lib/domain/types";

/**
 * THE COPILOT'S ENTIRE VOCABULARY.
 *
 * The model is given these function declarations and forced into
 * `FunctionCallingConfigMode.ANY`, so every response MUST be a call to one of
 * them. It has no free-text channel through which to invent an action, and no
 * function that writes to the database — the most powerful thing it can do is
 * *describe* a change it would like a human to make.
 *
 * The declarations constrain the SHAPE of what comes back. They do not
 * constrain the MEANING, so every payload is re-validated with the Zod schemas
 * at the bottom of this file before anything downstream touches it. Gemini's
 * schema dialect has no `additionalProperties: false`, which makes that second
 * pass load-bearing rather than merely belt-and-braces: Zod is what strips any
 * field we did not ask for.
 */

const dateProp: Schema = {
  type: Type.STRING,
  description: "A calendar date in Malaysia, formatted YYYY-MM-DD.",
};

const timeProp: Schema = {
  type: Type.STRING,
  description: "A 24-hour wall-clock time in Malaysia, formatted HH:mm.",
};

const nullableDateProp = (description: string): Schema => ({
  type: Type.STRING,
  nullable: true,
  description,
});

/** Reference to an event from the schedule snapshot, e.g. "E7". */
const eventRefProp: Schema = {
  type: Type.STRING,
  description:
    'The reference code of an existing event exactly as it appears in the schedule, for example "E7". Never invent one.',
};

const confidenceProp: Schema = {
  type: Type.NUMBER,
  description: "How confident you are that this matches what the user asked for, from 0 to 1.",
};

export const COPILOT_FUNCTIONS: FunctionDeclaration[] = [
  {
    name: "propose_reschedule",
    description:
      "Propose moving an existing event to a new date and/or time. Use when the user asks to move, shift, postpone, bring forward or reschedule an event.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        event_ref: eventRefProp,
        new_date: dateProp,
        new_end_date: nullableDateProp(
          "The LAST day of a multi-day event, YYYY-MM-DD, or null for a single-day event. The start and end times are the hours the event runs EACH day, so a two-day fair is 10:00-17:00 on both days, not one continuous overnight session.",
        ),
        new_start_time: timeProp,
        new_end_time: timeProp,
        reason: {
          type: Type.STRING,
          description:
            "One or two sentences explaining why this slot was chosen, referring to the actual schedule.",
        },
        confidence: confidenceProp,
      },
      required: [
        "event_ref",
        "new_date",
        "new_end_date",
        "new_start_time",
        "new_end_time",
        "reason",
        "confidence",
      ],
    },
  },
  {
    name: "propose_new_event",
    description:
      "Turn a natural-language description into a draft event for a human to review. Use when the user asks to create or add an event.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "A clear event title in Talentbank's style." },
        description: {
          type: Type.STRING,
          description: "A short public description, 1-3 sentences.",
        },
        date: dateProp,
        end_date: nullableDateProp(
          "The LAST day of a multi-day event, or null for a single-day event. The start and end times apply to EACH day.",
        ),
        start_time: timeProp,
        end_time: timeProp,
        location: { type: Type.STRING, description: "The venue name." },
        state: {
          type: Type.STRING,
          enum: [...MALAYSIAN_STATES],
          description: "The Malaysian state or federal territory.",
        },
        category: { type: Type.STRING, enum: [...EVENT_CATEGORIES] },
        audience: { type: Type.STRING, enum: [...EVENT_AUDIENCES] },
        capacity: { type: Type.INTEGER, description: "Maximum number of attendees." },
        reason: {
          type: Type.STRING,
          description:
            "Note any detail you had to infer or assume, so the reviewer knows what to check.",
        },
        confidence: confidenceProp,
      },
      required: [
        "title",
        "description",
        "date",
        "end_date",
        "start_time",
        "end_time",
        "location",
        "state",
        "category",
        "audience",
        "capacity",
        "reason",
        "confidence",
      ],
    },
  },
  {
    name: "propose_status_change",
    description:
      "Propose cancelling an event, marking it full, marking it completed, or reopening it.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        event_ref: eventRefProp,
        status: { type: Type.STRING, enum: [...EVENT_STATUSES] },
        reason: {
          type: Type.STRING,
          description:
            "The reason for the change. For a cancellation this is shown publicly, so write it for attendees.",
        },
        confidence: confidenceProp,
      },
      required: ["event_ref", "status", "reason", "confidence"],
    },
  },
  {
    name: "suggest_dates",
    description:
      "Suggest better slots for an existing event, ranked best first. Use when the user asks for a recommendation rather than a specific move.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        event_ref: eventRefProp,
        options: {
          type: Type.ARRAY,
          description: "Between one and three candidate slots, best first.",
          minItems: "1",
          maxItems: "3",
          items: {
            type: Type.OBJECT,
            properties: {
              date: dateProp,
              end_date: nullableDateProp(
                "The LAST day if the slot spans several days, or null. Times apply to each day.",
              ),
              start_time: timeProp,
              end_time: timeProp,
              reason: {
                type: Type.STRING,
                description: "Why this slot is good, citing the actual schedule.",
              },
            },
            required: ["date", "end_date", "start_time", "end_time", "reason"],
          },
        },
        confidence: confidenceProp,
      },
      required: ["event_ref", "options", "confidence"],
    },
  },
  {
    name: "answer_question",
    description:
      "Answer a read-only question about the schedule using only the snapshot provided. Use when the user is asking rather than instructing.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        answer: {
          type: Type.STRING,
          description:
            "A direct answer grounded in the schedule snapshot. If the snapshot does not contain the answer, say so plainly.",
        },
      },
      required: ["answer"],
    },
  },
  {
    name: "ask_for_clarification",
    description:
      "Use when the request is ambiguous, refers to an event that is not in the schedule, or is missing information you would have to guess.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        question: {
          type: Type.STRING,
          description: "The single most useful question to ask the events team.",
        },
      },
      required: ["question"],
    },
  },
];

/* -------------------------------------------------------------------------- *
 * Second line of defence: our own schemas.
 *
 * `nullish().transform(...)` rather than plain `nullable()` throughout: a
 * declared-required field can still come back missing, and a proposal that is
 * merely missing an optional end date should be normalised rather than thrown
 * away. Anything genuinely malformed still fails and is rejected upstream.
 * -------------------------------------------------------------------------- */

/** `null | undefined` both become `null`, so downstream code has one case. */
const optionalDate = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

/** Absent confidence stays absent — we never fabricate a number for the UI. */
const confidence = z
  .number()
  .min(0)
  .max(1)
  .nullish()
  .transform((value) => value ?? undefined);

export const rescheduleArgs = z.object({
  event_ref: z.string().min(1),
  new_date: z.string(),
  new_end_date: optionalDate,
  new_start_time: z.string(),
  new_end_time: z.string(),
  reason: z.string(),
  confidence,
});

export const newEventArgs = z.object({
  title: z.string().min(1),
  description: z.string(),
  date: z.string(),
  end_date: optionalDate,
  start_time: z.string(),
  end_time: z.string(),
  location: z.string().min(1),
  state: z.enum(MALAYSIAN_STATES),
  category: z.enum(EVENT_CATEGORIES),
  audience: z.enum(EVENT_AUDIENCES),
  capacity: z.number().int().positive(),
  reason: z.string(),
  confidence,
});

export const statusChangeArgs = z.object({
  event_ref: z.string().min(1),
  status: z.enum(EVENT_STATUSES),
  reason: z.string(),
  confidence,
});

export const suggestDatesArgs = z.object({
  event_ref: z.string().min(1),
  options: z
    .array(
      z.object({
        date: z.string(),
        end_date: optionalDate,
        start_time: z.string(),
        end_time: z.string(),
        reason: z.string(),
      }),
    )
    .min(1)
    .max(3),
  confidence,
});

export const answerArgs = z.object({ answer: z.string().min(1) });
export const clarifyArgs = z.object({ question: z.string().min(1) });
