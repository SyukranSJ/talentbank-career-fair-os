"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getEventById } from "@/lib/data/events";
import { validateRegistrationInput } from "@/lib/domain/rules";
import {
  audienceRestrictionMessage,
  isRegistrationOpen,
  isUserTypeAllowed,
  registrationClosedReason,
} from "@/lib/domain/availability";

/**
 * Public registration.
 *
 * FOUR LAYERS OF VALIDATION, ON PURPOSE:
 *   1. The browser marks fields required (nice, but trivially bypassed).
 *   2. This server action re-validates shape with the SAME Zod schema and
 *      re-checks that the event is actually open.
 *   3. `register_for_event()` in Postgres re-normalises and re-checks.
 *   4. A BEFORE INSERT trigger locks the event row and refuses to let the
 *      count exceed capacity, which is the only layer that survives two
 *      people registering in the same millisecond.
 *
 * Layers 1-3 exist to give good error messages. Layer 4 exists to be correct.
 */

export interface RegistrationState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Echoed back so the confirmation screen can show live numbers. */
  remaining?: number;
  registeredName?: string;
}

const FRIENDLY_ERRORS: Record<string, string> = {
  DUPLICATE:
    "This email address is already registered for this event. Check your inbox for the original confirmation.",
  FULL: "This event filled up while you were completing the form. All places have now been taken.",
  CANCELLED: "This event has been cancelled and is no longer accepting registrations.",
  COMPLETED: "This event has already taken place.",
  NOT_FOUND: "We could not find that event.",
  INVALID_EMAIL: "Please enter a valid email address.",
  INVALID_NAME: "Please enter your full name.",
  INVALID_USER_TYPE: "Please choose whether you are a candidate or an employer.",
  AUDIENCE_CANDIDATES_ONLY: "This event is for candidates only.",
  AUDIENCE_EMPLOYERS_ONLY: "This event is for employers only.",
};

export async function registerForEvent(
  _prev: RegistrationState,
  formData: FormData,
): Promise<RegistrationState> {
  const eventId = String(formData.get("eventId") ?? "");
  const slug = String(formData.get("slug") ?? "");

  // --- Layer 2a: shape ---------------------------------------------------
  const validation = validateRegistrationInput({
    name: formData.get("name"),
    email: formData.get("email"),
    userType: formData.get("userType"),
  });

  if (!validation.ok) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of validation.errors) fieldErrors[issue.field] = issue.message;
    return { status: "error", message: "Please check the highlighted fields.", fieldErrors };
  }

  // --- Layer 2b: is this event actually open right now? -------------------
  const event = await getEventById(eventId);
  if (!event) {
    return { status: "error", message: FRIENDLY_ERRORS.NOT_FOUND };
  }

  const now = new Date();
  if (!isRegistrationOpen(event, now)) {
    return {
      status: "error",
      message: registrationClosedReason(event, now) ?? "Registration is closed for this event.",
    };
  }

  // --- Layer 2c: does this event accept this role at all? -----------------
  // Hiding the option in the form is not enough; the form is a client and can
  // be bypassed. This is the check that actually holds.
  if (!isUserTypeAllowed(event.audience, validation.value.userType)) {
    return {
      status: "error",
      message:
        audienceRestrictionMessage(event.audience) ??
        "That registration type is not accepted for this event.",
      fieldErrors: { userType: "Not accepted for this event." },
    };
  }

  // --- Layer 3 + 4: the database has the final say ------------------------
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("register_for_event", {
    p_event_id: eventId,
    p_name: validation.value.name,
    p_email: validation.value.email,
    p_user_type: validation.value.userType,
  });

  if (error) {
    return {
      status: "error",
      message: "Something went wrong saving your registration. Please try again.",
    };
  }

  const result = data as { ok: boolean; code?: string; remaining?: number };

  if (!result.ok) {
    return {
      status: "error",
      message: FRIENDLY_ERRORS[result.code ?? ""] ?? "We could not complete your registration.",
    };
  }

  // The capacity numbers on the calendar and the detail page just changed.
  revalidatePath("/");
  revalidatePath(`/events/${slug}`);
  revalidatePath("/admin");

  return {
    status: "success",
    remaining: result.remaining,
    registeredName: validation.value.name,
  };
}
