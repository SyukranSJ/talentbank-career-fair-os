"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { registerForEvent, type RegistrationState } from "@/lib/actions/registration";
import type { EventWithAvailability } from "@/lib/domain/types";
import { allowedUserTypes } from "@/lib/domain/availability";
import { USER_TYPE_COPY } from "@/lib/domain/types";

const INITIAL: RegistrationState = { status: "idle" };

export function RegistrationForm({
  event,
  remaining,
}: {
  event: EventWithAvailability;
  remaining: number;
}) {
  const [state, formAction] = useActionState(registerForEvent, INITIAL);

  const allowed = allowedUserTypes(event.audience);
  const audienceNote =
    event.audience === "CANDIDATES"
      ? "This event is for candidates only."
      : event.audience === "EMPLOYERS"
        ? "This event is for employers only."
        : "";

  if (state.status === "success") {
    return (
      <div className="card border-[var(--color-status-open-line)] bg-[var(--color-status-open-bg)] p-6 text-center">
        <div className="mx-auto grid size-11 place-items-center rounded-full bg-[var(--color-status-open)] text-white">
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h3 className="mt-3 text-lg font-bold text-[var(--color-status-open)]">
          You&rsquo;re registered
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--foreground)]">
          Thanks {state.registeredName}. Your place at <strong>{event.title}</strong> is confirmed.
        </p>
        <p className="mt-3 text-xs text-[var(--muted-foreground)]">
          {typeof state.remaining === "number" && state.remaining > 0
            ? `${state.remaining} ${state.remaining === 1 ? "place is" : "places are"} still available.`
            : "That was one of the last places."}
        </p>
        <p className="mt-4 rounded-md bg-white/70 px-3 py-2 text-[11px] text-[var(--muted-foreground)]">
          This is a prototype, so no confirmation email is sent. Your registration is stored in the
          database and appears immediately in the events team dashboard.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="card p-5">
      <input type="hidden" name="eventId" value={event.id} />
      <input type="hidden" name="slug" value={event.slug} />

      <h3 className="text-base font-bold text-[var(--color-ink-900)]">Register for this event</h3>
      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
        Free to attend. {remaining.toLocaleString()} {remaining === 1 ? "place" : "places"} left.
      </p>

      {state.status === "error" && state.message && (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-[var(--color-status-cancelled-bg)] px-3 py-2.5 text-sm font-medium text-[var(--color-status-cancelled)]"
        >
          {state.message}
        </p>
      )}

      <div className="mt-4 space-y-4">
        <Field
          label="Full name"
          name="name"
          type="text"
          autoComplete="name"
          placeholder="Aisyah Rahman"
          error={state.fieldErrors?.name}
        />
        <Field
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          error={state.fieldErrors?.email}
        />

        {/* Only the roles this event's audience accepts. When an event takes
            just one, the choice is stated rather than offered — a disabled
            radio would submit nothing, and a hidden-but-present control would
            still be submittable. The server re-checks this regardless. */}
        {allowed.length === 1 ? (
          <div>
            <p className="text-sm font-semibold text-[var(--color-ink-900)]">
              I am registering as
            </p>
            <input type="hidden" name="userType" value={allowed[0]} />
            <p className="mt-1.5 rounded-lg border bg-[var(--surface-muted)] px-3 py-2.5 text-sm">
              <span className="font-semibold text-[var(--color-ink-900)]">
                {USER_TYPE_COPY[allowed[0]].title}
              </span>
              <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                {audienceNote}
              </span>
            </p>
          </div>
        ) : (
          <fieldset>
            <legend className="text-sm font-semibold text-[var(--color-ink-900)]">
              I am registering as
            </legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {allowed.map((type, index) => (
                <RadioCard
                  key={type}
                  name="userType"
                  value={type}
                  title={USER_TYPE_COPY[type].title}
                  subtitle={USER_TYPE_COPY[type].subtitle}
                  defaultChecked={index === 0}
                />
              ))}
            </div>
          </fieldset>
        )}
        {state.fieldErrors?.userType && (
          <p className="mt-1 text-xs text-[var(--color-status-cancelled)]">
            {state.fieldErrors.userType}
          </p>
        )}
      </div>

      <SubmitButton />

      <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
        We only use your details to manage your place at this event.
      </p>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-5 w-full rounded-lg bg-[var(--color-brand-600)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-brand-700)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Confirming your place…" : "Confirm my place"}
    </button>
  );
}

function Field({
  label,
  name,
  type,
  placeholder,
  autoComplete,
  error,
}: {
  label: string;
  name: string;
  type: string;
  placeholder?: string;
  autoComplete?: string;
  error?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-semibold text-[var(--color-ink-900)]">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
        className={`mt-1.5 w-full rounded-lg border bg-white px-3 py-2 text-sm placeholder:text-slate-400 ${
          error ? "border-[var(--color-status-cancelled)]" : ""
        }`}
      />
      {error && (
        <p id={`${name}-error`} className="mt-1 text-xs text-[var(--color-status-cancelled)]">
          {error}
        </p>
      )}
    </div>
  );
}

function RadioCard({
  name,
  value,
  title,
  subtitle,
  defaultChecked,
}: {
  name: string;
  value: string;
  title: string;
  subtitle: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="relative flex cursor-pointer flex-col rounded-lg border bg-white p-3 text-sm transition-colors has-[:checked]:border-[var(--color-brand-600)] has-[:checked]:bg-[var(--color-brand-50)] has-[:checked]:ring-1 has-[:checked]:ring-[var(--color-brand-600)]">
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="sr-only"
      />
      <span className="font-semibold text-[var(--color-ink-900)]">{title}</span>
      <span className="text-xs text-[var(--muted-foreground)]">{subtitle}</span>
    </label>
  );
}
