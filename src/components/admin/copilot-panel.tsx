"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applyCopilotProposal,
  askCopilot,
  type CopilotProposal,
  type CopilotResult,
  type ProposedSlot,
} from "@/lib/actions/copilot";
import { CATEGORY_LABELS, AUDIENCE_LABELS, STATUS_LABELS } from "@/lib/domain/types";
import type { EventCategory, EventAudience } from "@/lib/domain/types";
import { formatDateLong, formatTime12h, weekdayName } from "@/lib/domain/time";
import { canApplyChange, requiresAcknowledgement } from "@/lib/domain/conflicts";
import { ConflictList, WarningList } from "./conflict-list";

/**
 * The Event Copilot surface.
 *
 * Everything here is designed to make one thing obvious to the person using it:
 * NOTHING HAS CHANGED YET. The panel has its own violet accent so it reads as
 * "assistive", every proposal is framed as something the Copilot understood
 * rather than something it did, and the only way data moves is the Apply button.
 */

const EXAMPLES = [
  "Move the KL AI & Data Career Fair to the following Thursday afternoon",
  "Suggest a better date for the Selangor Manufacturing Careers Day",
  "Create a graduate career fair in Kuala Lumpur on 15 October from 10am to 4pm, capacity 300, for final-year students and employers",
  "Which events in October still have more than 200 places left?",
];

export function CopilotPanel() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<CopilotResult | null>(null);
  const [thinking, setThinking] = useState(false);
  const [acknowledge, setAcknowledge] = useState(false);
  const [applyState, setApplyState] = useState<{ ok: boolean; message: string } | null>(null);
  const [isApplying, startApply] = useTransition();

  async function submit(text: string) {
    if (!text.trim() || thinking) return;
    setThinking(true);
    setResult(null);
    setApplyState(null);
    setAcknowledge(false);
    try {
      setResult(await askCopilot(text));
    } catch {
      setResult({ ok: false, error: "The Copilot request failed. Please try again." });
    } finally {
      setThinking(false);
    }
  }

  function apply(proposal: CopilotProposal, acknowledgeConflicts = acknowledge) {
    startApply(async () => {
      let outcome;
      try {
        outcome = await applyCopilotProposal(proposal, acknowledgeConflicts);
      } catch {
        setApplyState({
          ok: false,
          message: "Could not reach the server, so nothing was changed. Try again.",
        });
        return;
      }
      if (outcome.ok) {
        setApplyState({ ok: true, message: outcome.message ?? "Applied." });
        setResult(null);
        setMessage("");
        router.refresh();
      } else {
        setApplyState({
          ok: false,
          message:
            outcome.message ??
            outcome.errors?.map((e) => e.message).join(" ") ??
            "Could not apply this change.",
        });
      }
    });
  }

  const proposal = result?.ok ? result.proposal : undefined;
  const conflicts = collectConflicts(proposal);
  const needsAcknowledgement = requiresAcknowledgement(conflicts);

  return (
    <section className="card overflow-hidden border-[var(--color-copilot-200)]">
      <header className="flex items-start gap-3 border-b border-[var(--color-copilot-200)] bg-gradient-to-r from-[var(--color-copilot-50)] to-white p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--color-copilot-600)] text-white">
          <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
            <path d="M12 2.5 13.7 8l5.5 1.7-5.5 1.7L12 17l-1.7-5.6L4.8 9.7 10.3 8 12 2.5ZM19 14l.8 2.4 2.4.8-2.4.8L19 20.4l-.8-2.4-2.4-.8 2.4-.8L19 14Z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-[var(--color-ink-900)]">Event Copilot</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted-foreground)]">
            Describe what you want in plain English. The Copilot reads the real calendar and
            proposes a change — <strong className="font-semibold">you approve it before anything
            is saved.</strong>
          </p>
        </div>
      </header>

      <div className="p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(message);
          }}
        >
          <label htmlFor="copilot-input" className="sr-only">
            Ask the Event Copilot
          </label>
          <textarea
            id="copilot-input"
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit(message);
              }
            }}
            placeholder="Move the Penang Tech Talent Fair to the first week of October…"
            className="w-full resize-y rounded-lg border bg-white px-3 py-2.5 text-sm placeholder:text-slate-400"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-[11px] text-[var(--muted-foreground)]">⌘↵ to send</p>
            <button
              type="submit"
              disabled={thinking || !message.trim()}
              className="rounded-lg bg-[var(--color-copilot-600)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-copilot-700)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {thinking ? "Reading the calendar…" : "Ask Copilot"}
            </button>
          </div>
        </form>

        {!result && !thinking && !applyState && (
          <div className="mt-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
              Try
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    setMessage(example);
                    submit(example);
                  }}
                  className="rounded-full border border-[var(--color-copilot-200)] bg-[var(--color-copilot-50)] px-3 py-1.5 text-left text-xs font-medium text-[var(--color-copilot-700)] hover:bg-[var(--color-copilot-100)]"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        {thinking && (
          <p className="mt-4 flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <span className="size-2 animate-pulse rounded-full bg-[var(--color-copilot-500)]" />
            Reading the calendar and checking for conflicts…
          </p>
        )}

        {applyState && (
          <p
            role="status"
            className={`mt-4 rounded-lg px-3 py-2.5 text-sm font-medium ${
              applyState.ok
                ? "bg-[var(--color-status-open-bg)] text-[var(--color-status-open)]"
                : "bg-[var(--color-status-cancelled-bg)] text-[var(--color-status-cancelled)]"
            }`}
          >
            {applyState.ok ? "✓ " : ""}
            {applyState.message}
          </p>
        )}

        {/* ------------------------------------------------ rejected by us */}
        {result && !result.ok && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-[var(--color-status-cancelled-line)] bg-[var(--color-status-cancelled-bg)] p-3"
          >
            <p className="text-sm font-bold text-[var(--color-status-cancelled)]">
              Proposal rejected
            </p>
            <p className="mt-1 text-sm text-[var(--foreground)]">{result.error}</p>
            {result.rejectedAt && (
              <p className="mt-2 text-[11px] font-medium text-[var(--muted-foreground)]">
                Caught by the validation layer at: {result.rejectedAt}
              </p>
            )}
          </div>
        )}

        {/* -------------------------------------------------------- results */}
        {proposal && (
          <div className="mt-4 space-y-3">
            {proposal.kind === "ANSWER" && (
              <Block title="Answer">
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{proposal.answer}</p>
                <Footnote>
                  Read-only. The Copilot answered from the current calendar and changed nothing.
                </Footnote>
              </Block>
            )}

            {proposal.kind === "CLARIFY" && (
              <Block title="Needs more detail">
                <p className="text-sm leading-relaxed">{proposal.question}</p>
                <Footnote>
                  The Copilot asked instead of guessing, so nothing was proposed.
                </Footnote>
              </Block>
            )}

            {proposal.kind === "RESCHEDULE" && (
              <Block title={`Proposed move · ${proposal.eventTitle}`}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <SlotCard label="Currently" tone="muted">
                    <SlotText
                      date={proposal.current.date}
                      endDate={proposal.current.endDate}
                      startTime={proposal.current.startTime}
                      endTime={proposal.current.endTime}
                    />
                  </SlotCard>
                  <SlotCard label="Proposed" tone="accent">
                    <SlotText
                      date={proposal.proposed.date}
                      endDate={proposal.proposed.endDate}
                      startTime={proposal.proposed.startTime}
                      endTime={proposal.proposed.endTime}
                    />
                  </SlotCard>
                </div>

                <Reasoning text={proposal.proposed.reason} />
                <ConflictList conflicts={proposal.proposed.check.conflicts} />
                <WarningList warnings={proposal.proposed.check.warnings} />
              </Block>
            )}

            {proposal.kind === "SUGGESTIONS" && (
              <Block title={`Suggested dates · ${proposal.eventTitle}`}>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Currently {formatDateLong(proposal.current.date)},{" "}
                  {formatTime12h(proposal.current.startTime)} –{" "}
                  {formatTime12h(proposal.current.endTime)}
                </p>
                <ol className="space-y-2.5">
                  {proposal.options.map((option, index) => (
                    <SuggestionCard
                      key={`${option.date}-${option.startTime}`}
                      option={option}
                      rank={index}
                      disabled={isApplying}
                      onApply={(acknowledged) =>
                        apply(
                          {
                            kind: "RESCHEDULE",
                            eventId: proposal.eventId,
                            eventTitle: proposal.eventTitle,
                            current: {
                              date: proposal.current.date,
                              endDate: null,
                              startTime: proposal.current.startTime,
                              endTime: proposal.current.endTime,
                            },
                            proposed: option,
                          },
                          acknowledged,
                        )
                      }
                    />
                  ))}
                </ol>
              </Block>
            )}

            {proposal.kind === "CREATE" && (
              <Block title="Draft event">
                <p className="text-xs text-[var(--muted-foreground)]">
                  The Copilot generated the following event. Review it before publishing.
                </p>
                <dl className="grid gap-x-4 gap-y-2 rounded-lg bg-white p-3 text-sm sm:grid-cols-2">
                  <Row label="Title" value={proposal.draft.title} span />
                  <Row
                    label="Date"
                    value={
                      proposal.draft.endDate
                        ? `${formatDateLong(proposal.draft.date)} – ${formatDateLong(proposal.draft.endDate)}`
                        : `${formatDateLong(proposal.draft.date)} (${weekdayName(proposal.draft.date)})`
                    }
                  />
                  <Row
                    label="Time"
                    value={`${formatTime12h(proposal.draft.startTime)} – ${formatTime12h(proposal.draft.endTime)}`}
                  />
                  <Row label="Venue" value={proposal.draft.location} />
                  <Row label="State" value={proposal.draft.state} />
                  <Row
                    label="Type"
                    value={CATEGORY_LABELS[proposal.draft.category as EventCategory] ?? proposal.draft.category}
                  />
                  <Row
                    label="Audience"
                    value={AUDIENCE_LABELS[proposal.draft.audience as EventAudience] ?? proposal.draft.audience}
                  />
                  <Row label="Capacity" value={proposal.draft.capacity.toLocaleString()} />
                  {proposal.draft.description && (
                    <Row label="Description" value={proposal.draft.description} span />
                  )}
                </dl>

                <Reasoning text={proposal.reason} />
                <ConflictList conflicts={proposal.check.conflicts} />
                <WarningList warnings={proposal.check.warnings} />
              </Block>
            )}

            {proposal.kind === "STATUS" && (
              <Block title={`Proposed status change · ${proposal.eventTitle}`}>
                <p className="text-sm">
                  <span className="rounded bg-slate-100 px-2 py-1 font-semibold">
                    {STATUS_LABELS[proposal.from]}
                  </span>
                  <span className="mx-2 text-[var(--muted-foreground)]">→</span>
                  <span className="rounded bg-[var(--color-copilot-100)] px-2 py-1 font-semibold text-[var(--color-copilot-700)]">
                    {STATUS_LABELS[proposal.to]}
                  </span>
                </p>
                <Reasoning text={proposal.reason} />
                {proposal.to === "CANCELLED" && proposal.registeredCount > 0 && (
                  <p className="rounded-lg bg-[var(--color-status-cancelled-bg)] px-3 py-2 text-xs font-medium text-[var(--color-status-cancelled)]">
                    {proposal.registeredCount.toLocaleString()} people are already registered for
                    this event. The reason above will be shown publicly on the event page.
                  </p>
                )}
              </Block>
            )}

            {/* ------------------------------------------- approval controls */}
            {proposal.kind !== "ANSWER" &&
              proposal.kind !== "CLARIFY" &&
              proposal.kind !== "SUGGESTIONS" && (
                <div className="rounded-lg border bg-white p-3">
                  {needsAcknowledgement && (
                    <label className="mb-3 flex cursor-pointer items-start gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={acknowledge}
                        onChange={(e) => setAcknowledge(e.target.checked)}
                        className="mt-0.5 size-4"
                      />
                      <span className="text-[var(--foreground)]">
                        I have read the conflicts above and want to go ahead anyway.
                      </span>
                    </label>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isApplying || !canApplyChange(conflicts, acknowledge)}
                      onClick={() => apply(proposal)}
                      className="rounded-lg bg-[var(--color-copilot-600)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-copilot-700)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isApplying ? "Applying…" : "Apply this change"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setResult(null);
                        setAcknowledge(false);
                      }}
                      className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                    >
                      Discard
                    </button>
                    {typeof result?.confidence === "number" && (
                      <span className="ml-auto text-[11px] font-medium text-[var(--muted-foreground)]">
                        Copilot confidence {Math.round(result.confidence * 100)}%
                      </span>
                    )}
                  </div>

                  <p className="mt-2.5 border-t pt-2.5 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
                    Nothing has been saved yet. Applying runs the same validation and writes the
                    same audit record as editing the event by hand, tagged as a Copilot change.
                  </p>
                </div>
              )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- fragments -- */

function collectConflicts(proposal?: CopilotProposal) {
  if (!proposal) return [];
  if (proposal.kind === "RESCHEDULE") return proposal.proposed.check.conflicts;
  if (proposal.kind === "CREATE") return proposal.check.conflicts;
  return [];
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--color-copilot-200)] bg-[var(--color-copilot-50)]/50 p-3">
      <p className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-copilot-700)]">
        {title}
      </p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function SlotCard({
  label,
  tone,
  children,
}: {
  label: string;
  tone: "muted" | "accent";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        tone === "accent"
          ? "border-[var(--color-copilot-300)] bg-white"
          : "border-slate-200 bg-slate-50"
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function SlotText({
  date,
  endDate,
  startTime,
  endTime,
}: {
  date: string;
  endDate: string | null;
  startTime: string;
  endTime: string;
}) {
  return (
    <>
      <p className="text-sm font-semibold text-[var(--color-ink-900)]">
        {formatDateLong(date)}
        {endDate && ` – ${formatDateLong(endDate)}`}
      </p>
      <p className="text-xs text-[var(--muted-foreground)]">
        {weekdayName(date)} · {formatTime12h(startTime)} – {formatTime12h(endTime)}
      </p>
    </>
  );
}

function SuggestionCard({
  option,
  rank,
  disabled,
  onApply,
}: {
  option: ProposedSlot;
  rank: number;
  disabled: boolean;
  onApply: (acknowledged: boolean) => void;
}) {
  // Each suggested slot carries its OWN conflicts, so each one needs its own
  // acknowledgement. A single panel-level checkbox would let a tick on the
  // recommended slot silently authorise a different, clashing alternative.
  const [acknowledged, setAcknowledged] = useState(false);
  const conflicts = option.check.conflicts;
  const needsAcknowledgement = requiresAcknowledgement(conflicts);
  const canApply = canApplyChange(conflicts, acknowledged);

  return (
    <li className="rounded-lg border bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
            {rank === 0 ? "Recommended" : `Alternative ${rank}`}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-[var(--color-ink-900)]">
            {formatDateLong(option.date)}
            {option.endDate && ` – ${formatDateLong(option.endDate)}`}
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">
            {weekdayName(option.date)} · {formatTime12h(option.startTime)} –{" "}
            {formatTime12h(option.endTime)}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            needsAcknowledgement
              ? "bg-[var(--color-status-full-bg)] text-[var(--color-status-full)]"
              : "bg-[var(--color-status-open-bg)] text-[var(--color-status-open)]"
          }`}
        >
          {needsAcknowledgement
            ? `${conflicts.length} ${conflicts.length === 1 ? "clash" : "clashes"}`
            : "No conflicts"}
        </span>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-[var(--foreground)]">{option.reason}</p>

      {needsAcknowledgement && (
        <div className="mt-2 space-y-2">
          <ConflictList conflicts={conflicts} />
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 size-4"
            />
            <span className="text-[var(--foreground)]">
              I have read the {conflicts.length === 1 ? "conflict" : "conflicts"} above and want to
              move it here anyway.
            </span>
          </label>
        </div>
      )}

      <button
        type="button"
        disabled={disabled || !canApply}
        onClick={() => onApply(acknowledged)}
        className="mt-3 rounded-lg border border-[var(--color-copilot-300)] bg-[var(--color-copilot-50)] px-3 py-1.5 text-xs font-semibold text-[var(--color-copilot-700)] hover:bg-[var(--color-copilot-100)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {needsAcknowledgement ? "Move here anyway" : "Move to this slot"}
      </button>

      {needsAcknowledgement && !acknowledged && (
        <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
          Tick the box above to enable this.
        </p>
      )}
    </li>
  );
}

function Reasoning({ text }: { text: string }) {
  return (
    <div className="rounded-lg bg-white/70 p-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
        Copilot reasoning
      </p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--foreground)]">{text}</p>
    </div>
  );
}

function Footnote({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-t border-[var(--color-copilot-200)] pt-2 text-[11px] text-[var(--muted-foreground)]">
      {children}
    </p>
  );
}

function Row({ label, value, span }: { label: string; value: string; span?: boolean }) {
  return (
    <div className={span ? "sm:col-span-2" : undefined}>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-[var(--foreground)]">{value}</dd>
    </div>
  );
}
