import "server-only";
import {
  ApiError,
  FunctionCallingConfigMode,
  GoogleGenAI,
  ThinkingLevel,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from "@google/genai";
import { getGeminiKey, getGeminiModel, getGeminiThinkingLevel } from "@/lib/env";
import { COPILOT_FUNCTIONS } from "./tools";
import { COPILOT_SYSTEM_PROMPT, type ScheduleSnapshot } from "./context";

/**
 * The ONLY place in the codebase that talks to an LLM.
 *
 * It takes text in and returns a function name plus raw arguments. It does not
 * touch the database, it does not decide whether the proposal is valid, and it
 * has no access to anything except the snapshot it is handed. Everything that
 * could change data happens after this function returns, in code that treats
 * its output as untrusted input.
 *
 * Swapping the provider (this file changed; nothing else did) is the practical
 * proof that the architecture holds: the boundary is "natural language in,
 * structured proposal out", not "Anthropic" or "Google".
 */

export type InterpretResult =
  | { ok: true; tool: string; args: unknown; usage: { input: number; output: number } }
  | { ok: false; error: string; kind: "NOT_CONFIGURED" | "API_ERROR" | "NO_TOOL_CALL" };

/**
 * Free-tier models that were verified to work with these function
 * declarations. Note that gemini-2.5-flash is deliberately NOT listed: Google
 * now returns 404 for it on newly created API keys.
 */
const ALTERNATIVE_MODELS = "gemini-3.5-flash-lite, gemini-3.6-flash or gemini-3.1-flash-lite";

/**
 * A scheduling suggestion is only useful if it arrives while the coordinator
 * is still looking at the screen. Without this the SDK will happily wait more
 * than a minute for an overloaded model before failing anyway.
 *
 * 24s is chosen so the WORST case fits inside the 60s function limit declared
 * in src/app/admin/page.tsx: 24s + 1.5s retry pause + 24s + database reads.
 * At 30s the worst case was ~62s and would have been cut off by the platform.
 * Normal responses take 2-5s, so this ceiling is never reached in practice.
 */
const REQUEST_TIMEOUT_MS = 24_000;

/**
 * One retry, for transient capacity failures only.
 *
 * 429 is deliberately NOT in this set. A rate limit resets on a per-minute
 * window, so retrying 1.5 seconds later is almost guaranteed to fail — and it
 * spends a second request from the very quota that just ran out, bringing the
 * next genuine request closer to failing too. Measured on the free tier, the
 * retry turned a recoverable "wait a moment" into exhausting the window twice
 * as fast. A 500/503 is different: that is server-side load, and one retry
 * clears it often enough to be worth the wait.
 */
const RETRYABLE_STATUSES = new Set([500, 503]);
const RETRY_DELAY_MS = 1_500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function interpretRequest(
  message: string,
  snapshot: ScheduleSnapshot,
): Promise<InterpretResult> {
  const apiKey = getGeminiKey();
  if (!apiKey) {
    return {
      ok: false,
      kind: "NOT_CONFIGURED",
      error:
        "The Copilot is not configured. Add GEMINI_API_KEY to .env.local and restart the server.",
    };
  }

  const model = getGeminiModel();
  const thinkingLevel = getGeminiThinkingLevel();
  const ai = new GoogleGenAI({ apiKey });

  const buildRequest = (withThinking: boolean): GenerateContentParameters => ({
    model,
    contents: [
      {
        role: "user",
        parts: [{ text: `${snapshot.text}\n\nEVENTS TEAM REQUEST:\n${message}` }],
      },
    ],
    config: {
      systemInstruction: COPILOT_SYSTEM_PROMPT,
      tools: [{ functionDeclarations: COPILOT_FUNCTIONS }],
      // The model MUST answer by calling one of our functions. It has no
      // free-text channel, so it cannot invent an action outside the
      // defined vocabulary.
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: COPILOT_FUNCTIONS.map((fn) => fn.name!),
        },
      },
      // Scheduling is a reasoning problem — the model has to compare a request
      // against a table of overlapping intervals — so thinking stays on, just
      // shallow. See getGeminiThinkingLevel() for why LOW.
      ...(withThinking && thinkingLevel
        ? { thinkingConfig: { thinkingLevel: ThinkingLevel[thinkingLevel] } }
        : {}),
      maxOutputTokens: 4096,
      abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  });

  let response: GenerateContentResponse;
  try {
    response = await generate(ai, buildRequest, thinkingLevel !== null);
  } catch (error) {
    return { ok: false, kind: "API_ERROR", error: describeApiError(error, model) };
  }

  const call = response.functionCalls?.[0];
  if (!call?.name) {
    // Safety filters and token exhaustion both land here rather than throwing.
    const blockReason = response.promptFeedback?.blockReason;
    return {
      ok: false,
      kind: "NO_TOOL_CALL",
      error: blockReason
        ? `The Copilot declined to answer that request (${blockReason}). Try rephrasing it.`
        : "The Copilot did not return a usable action. Try rephrasing the request.",
    };
  }

  const usage = response.usageMetadata;
  return {
    ok: true,
    tool: call.name,
    args: call.args ?? {},
    usage: {
      input: usage?.promptTokenCount ?? 0,
      output: usage?.candidatesTokenCount ?? 0,
    },
  };
}

/**
 * Sends the request, with two narrowly-scoped recoveries:
 *
 *   · A transient 429/500/503 is retried once. Free-tier capacity fluctuates,
 *     and one retry turns most of those into a success.
 *   · A 400 that complains about the thinking setting is retried once WITHOUT
 *     it. Thinking configuration is model-family specific, so this keeps the
 *     Copilot working if someone points GEMINI_MODEL at a model that does not
 *     accept the level we asked for, instead of failing outright.
 */
async function generate(
  ai: GoogleGenAI,
  buildRequest: (withThinking: boolean) => GenerateContentParameters,
  thinkingEnabled: boolean,
): Promise<GenerateContentResponse> {
  try {
    return await ai.models.generateContent(buildRequest(thinkingEnabled));
  } catch (error) {
    if (
      thinkingEnabled &&
      error instanceof ApiError &&
      error.status === 400 &&
      /thinking/i.test(String(error.message))
    ) {
      return ai.models.generateContent(buildRequest(false));
    }

    if (error instanceof ApiError && RETRYABLE_STATUSES.has(error.status)) {
      await sleep(RETRY_DELAY_MS);
      return ai.models.generateContent(buildRequest(thinkingEnabled));
    }

    throw error;
  }
}

/** Turns SDK errors into something an events coordinator can act on. */
function describeApiError(error: unknown, model: string): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
        return "The Copilot request was rejected as malformed. This is a bug rather than something you did.";
      case 401:
      case 403:
        return "The Gemini API key was rejected. Check GEMINI_API_KEY in .env.local.";
      case 404:
        return `The model "${model}" is not available on this API key. Set GEMINI_MODEL in .env.local to one of: ${ALTERNATIVE_MODELS}.`;
      case 429:
        // Not retried on purpose — see RETRYABLE_STATUSES. The two kinds of
        // 429 need completely different responses from the person reading
        // this, so the message says which one happened.
        return describeQuotaError(String(error.message), model);
      case 500:
      case 503:
        // Measured behaviour on the free tier, so the message says what to do.
        return `"${model}" is busy right now, and a retry did not get through either. Try again shortly, or set GEMINI_MODEL in .env.local to one of: ${ALTERNATIVE_MODELS}.`;
      default:
        return `The Copilot request failed (HTTP ${error.status}).`;
    }
  }

  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return `The Copilot took longer than ${REQUEST_TIMEOUT_MS / 1000} seconds to respond and was cancelled. Try again, or switch GEMINI_MODEL to a faster model.`;
  }

  if (error instanceof Error && /fetch|network|ENOTFOUND|ECONNREFUSED/i.test(error.message)) {
    return "Could not reach the Copilot service. Check your connection.";
  }

  return error instanceof Error ? error.message : "The Copilot failed unexpectedly.";
}

/**
 * Gemini reports two very different problems as 429:
 *
 *   · a per-MINUTE rate limit, which clears by waiting a moment, and
 *   · a per-DAY quota, which does not clear today at all.
 *
 * The daily one is easy to hit while developing — gemini-3.5-flash allows
 * only 20 free-tier requests per day — and telling someone to "wait a minute"
 * when the quota resets at midnight is actively misleading. Quotas are per
 * model, so switching models is the immediate workaround either way.
 */
function describeQuotaError(message: string, model: string): string {
  const quotaId = message.match(/"quotaId":\s*"([^"]+)"/)?.[1] ?? "";
  const quotaValue = message.match(/"quotaValue":\s*"([^"]+)"/)?.[1];

  if (/PerDay/i.test(quotaId)) {
    const allowance = quotaValue ? `${quotaValue} requests per day` : "its daily allowance";
    return `The free-tier daily quota for "${model}" is used up (${allowance}). It resets tomorrow. To keep working today, set GEMINI_MODEL in .env.local to one of: ${ALTERNATIVE_MODELS} — each model has its own separate quota.`;
  }

  return `"${model}" is rate limited right now. Wait about a minute and try again; the free tier allows only a few requests per minute.`;
}
