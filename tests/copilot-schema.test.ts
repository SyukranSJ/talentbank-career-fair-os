/**
 * Tests for the Copilot's structured-output contract.
 *
 * These need no API key and make no network calls: they check the boundary
 * between "whatever the model sent" and "what our code is allowed to act on".
 * That boundary is the safety argument of the whole feature, so it is the part
 * most worth testing.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  COPILOT_FUNCTIONS,
  answerArgs,
  clarifyArgs,
  newEventArgs,
  rescheduleArgs,
  statusChangeArgs,
  suggestDatesArgs,
} from "../src/lib/copilot/tools";

/* ------------------------------------------------- declaration integrity --- */

test("every declared function has a name, a description and a schema", () => {
  assert.equal(COPILOT_FUNCTIONS.length, 6);
  for (const fn of COPILOT_FUNCTIONS) {
    assert.ok(fn.name, "function needs a name");
    assert.ok(fn.description && fn.description.length > 20, `${fn.name} needs a real description`);
    assert.equal(fn.parameters?.type, "OBJECT", `${fn.name} must take an object`);
    // Gemini requires every declared name to match ^[a-zA-Z_][a-zA-Z0-9_.:-]*$
    assert.match(fn.name!, /^[a-zA-Z_][a-zA-Z0-9_.:-]{0,127}$/);
  }
});

test("every required property is actually declared", () => {
  for (const fn of COPILOT_FUNCTIONS) {
    const properties = fn.parameters?.properties ?? {};
    for (const required of fn.parameters?.required ?? []) {
      assert.ok(
        required in properties,
        `${fn.name} requires "${required}" but never declares it`,
      );
    }
  }
});

test("no declared function can write to the database", () => {
  // The vocabulary is the safety boundary: if a future edit adds a function
  // that sounds like it acts rather than proposes, this test should be the
  // thing that makes someone stop and think.
  const allowed = [
    "propose_reschedule",
    "propose_new_event",
    "propose_status_change",
    "suggest_dates",
    "answer_question",
    "ask_for_clarification",
  ];
  assert.deepEqual(COPILOT_FUNCTIONS.map((f) => f.name).sort(), [...allowed].sort());
});

test("the declarations serialise cleanly for the API", () => {
  const json = JSON.stringify(COPILOT_FUNCTIONS);
  assert.ok(json.length > 500);
  assert.deepEqual(JSON.parse(json).length, 6);
});

/* ---------------------------------------------------- argument validation --- */

/** Drops a key, the way a model omitting a field would. */
function without<T extends object, K extends keyof T>(source: T, key: K): Omit<T, K> {
  const copy = { ...source };
  delete copy[key];
  return copy;
}

const validReschedule = {
  event_ref: "E7",
  new_date: "2026-09-24",
  new_end_date: null,
  new_start_time: "10:00",
  new_end_time: "13:00",
  reason: "Avoids the afternoon clash with the Selangor fair.",
  confidence: 0.86,
};

test("a well-formed reschedule proposal parses", () => {
  const parsed = rescheduleArgs.safeParse(validReschedule);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data?.new_end_date, null);
  assert.equal(parsed.data?.confidence, 0.86);
});

test("an omitted end date is normalised to null rather than rejected", () => {
  // Gemini declares the field required, but a model can still leave it out.
  // A proposal that is merely missing an optional end date is still usable.
  const parsed = rescheduleArgs.safeParse(without(validReschedule, "new_end_date"));
  assert.equal(parsed.success, true);
  assert.equal(parsed.data?.new_end_date, null, "undefined collapses to null");
});

test("an omitted confidence stays absent instead of being invented", () => {
  const parsed = rescheduleArgs.safeParse(without(validReschedule, "confidence"));
  assert.equal(parsed.success, true);
  assert.equal(parsed.data?.confidence, undefined, "we never fabricate a confidence score");
});

test("a confidence outside 0-1 is rejected", () => {
  assert.equal(rescheduleArgs.safeParse({ ...validReschedule, confidence: 1.4 }).success, false);
  assert.equal(rescheduleArgs.safeParse({ ...validReschedule, confidence: -1 }).success, false);
});

test("fields the model invented are stripped, not passed through", () => {
  // Gemini's schema dialect has no `additionalProperties: false`, so this is
  // the layer that actually enforces it.
  const parsed = rescheduleArgs.safeParse({
    ...validReschedule,
    delete_all_events: true,
    event_id: "00000000-0000-0000-0000-000000000000",
  });
  assert.equal(parsed.success, true);
  assert.ok(!("delete_all_events" in (parsed.data ?? {})), "unknown keys must not survive");
  assert.ok(!("event_id" in (parsed.data ?? {})), "the model cannot smuggle in a raw row id");
});

test("a missing event reference is rejected outright", () => {
  assert.equal(rescheduleArgs.safeParse({ ...validReschedule, event_ref: "" }).success, false);
});

test("a draft event must use a real state, category and audience", () => {
  const base = {
    title: "Graduate Career Fair",
    description: "For final-year students and employers.",
    date: "2026-10-15",
    end_date: null,
    start_time: "10:00",
    end_time: "16:00",
    location: "Kuala Lumpur Convention Centre",
    state: "Kuala Lumpur",
    category: "PUBLIC_CAREER_FAIR",
    audience: "EVERYONE",
    capacity: 300,
    reason: "Capacity and audience taken directly from the request.",
    confidence: 0.9,
  };
  assert.equal(newEventArgs.safeParse(base).success, true);
  assert.equal(newEventArgs.safeParse({ ...base, state: "Bangkok" }).success, false);
  assert.equal(newEventArgs.safeParse({ ...base, category: "PARTY" }).success, false);
  assert.equal(newEventArgs.safeParse({ ...base, capacity: 0 }).success, false);
  assert.equal(newEventArgs.safeParse({ ...base, capacity: 12.5 }).success, false);
});

test("a status proposal must name a real status", () => {
  const base = { event_ref: "E3", status: "CANCELLED", reason: "Venue flooding.", confidence: 0.8 };
  assert.equal(statusChangeArgs.safeParse(base).success, true);
  assert.equal(statusChangeArgs.safeParse({ ...base, status: "DELETED" }).success, false);
});

test("suggestions are capped at three and cannot be empty", () => {
  const slot = {
    date: "2026-09-24",
    end_date: null,
    start_time: "10:00",
    end_time: "13:00",
    reason: "No conflicts.",
  };
  assert.equal(suggestDatesArgs.safeParse({ event_ref: "E1", options: [slot], confidence: 0.7 }).success, true);
  assert.equal(suggestDatesArgs.safeParse({ event_ref: "E1", options: [], confidence: 0.7 }).success, false);
  assert.equal(
    suggestDatesArgs.safeParse({ event_ref: "E1", options: [slot, slot, slot, slot], confidence: 0.7 }).success,
    false,
  );
});

test("read-only responses still have to say something", () => {
  assert.equal(answerArgs.safeParse({ answer: "Three events still have places." }).success, true);
  assert.equal(answerArgs.safeParse({ answer: "" }).success, false);
  assert.equal(clarifyArgs.safeParse({ question: "Which Penang fair do you mean?" }).success, true);
  assert.equal(clarifyArgs.safeParse({}).success, false);
});
