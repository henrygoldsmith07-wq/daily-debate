import { NextResponse } from "next/server";
import { checkRateLimit, checkRateLimitKey } from "@/lib/rateLimit";
import { debateOpening, debateTurn, debateTurnStream } from "@/lib/openrouter";
import { encodeSseEvent } from "@/lib/sse";
import { isSpendCapError } from "@/lib/spendCap";
import { moderateContent } from "@/lib/moderation";
import { getTodayTopic } from "@/lib/dailyTopic";
import { openingDirective, resolvePersona, turnDirective, type OpponentPersonaId } from "@/lib/opponentPersona";
import {
  GUEST_LIVE_RETEST_DIRECTIVE,
  GUEST_LIVE_ROUNDS,
  guestLiveDailyCallCap,
  guestLiveIpCallCap,
  validateGuestHistory,
  type GuestLiveHistoryEntry,
} from "@/lib/guestLive";
import { guestLiveAvailable } from "@/lib/guestLiveServer";
import { recordGuestSprint } from "@/lib/guestSprintCounterServer";

/**
 * Live guest sprint: the AI opponent for a signed-out learner.
 *
 * Stateless. The client sends its side, the opponent style and the transcript
 * so far; the route returns the opponent's next move and stores nothing about
 * the learner or what they wrote. The motion is always today's shared motion,
 * resolved here — the client cannot choose the prompt, so this endpoint cannot
 * be used as a general free model.
 *
 * Every failure answers `fallback: true`. The guest client then carries on
 * with the guided (scripted, local) case: a guest is never blocked.
 *
 *   history []                    -> opening move (JSON)
 *   history ending in user turn n -> reply; streamed when the client accepts
 *                                    text/event-stream (same events as the
 *                                    solo turn route: start/delta/reset/result)
 *   the reply to the third answer -> the retest's fresh challenge
 */

const DAY_MS = 24 * 60 * 60 * 1000;

interface GuestTurnContext {
  side: "for" | "against";
  persona: OpponentPersonaId;
  history: GuestLiveHistoryEntry[];
  userTurns: number;
  topic: { title: string; prompt: string };
}

function fallback(status: number, reason: string, error: string, headers?: Record<string, string>) {
  return NextResponse.json(
    { error, fallback: true, reason },
    { status, headers: { "Cache-Control": "no-store", ...(headers ?? {}) } },
  );
}

async function prepare(request: Request): Promise<{ response: Response } | { ctx: GuestTurnContext }> {
  if (!guestLiveAvailable()) {
    return { response: fallback(503, "unavailable", "The live opponent is not available right now.") };
  }

  const body = await request.json().catch(() => null);
  const side = body?.side;
  if (side !== "for" && side !== "against") {
    return { response: NextResponse.json({ error: "side must be for or against." }, { status: 400 }) };
  }
  const validated = validateGuestHistory(body?.history);
  if (!validated.ok) return { response: NextResponse.json({ error: validated.error }, { status: 400 }) };
  if (validated.userTurns > GUEST_LIVE_ROUNDS) {
    return { response: NextResponse.json({ error: "The sprint is already complete." }, { status: 400 }) };
  }
  const latest = validated.history[validated.history.length - 1];
  if (latest) {
    const moderation = moderateContent(latest.text);
    if (moderation.blocked) {
      return {
        response: NextResponse.json(
          { error: `Message blocked: ${moderation.flags.map((flag) => flag.note).join(" ")}` },
          { status: 400 },
        ),
      };
    }
  }

  // Two bounds, both shared across instances through Postgres and failing
  // CLOSED (a limiter outage means guided practice, never unbounded calls).
  const perIp = await checkRateLimit(request, {
    name: "guest-ai-ip",
    limit: guestLiveIpCallCap(),
    windowMs: DAY_MS,
    failClosed: true,
  });
  if (perIp) {
    return {
      response: fallback(429, "rate_limited", "You've used today's live debates. A guided case is ready instead.", {
        "Retry-After": perIp.headers.get("Retry-After") ?? "3600",
      }),
    };
  }
  const global = await checkRateLimitKey("all", {
    name: "guest-ai-global",
    limit: guestLiveDailyCallCap(),
    windowMs: DAY_MS,
    failClosed: true,
  });
  if (!global.ok) {
    return { response: fallback(503, "busy", "The live opponent is busy. A guided case is ready instead.") };
  }

  const topic = await getTodayTopic();
  return {
    ctx: {
      side,
      persona: resolvePersona(body?.persona),
      history: validated.history,
      userTurns: validated.userTurns,
      topic: { title: topic.title, prompt: topic.prompt },
    },
  };
}

function failureResponse(error: unknown) {
  if (isSpendCapError(error)) {
    return fallback(503, "spend_cap", "The live opponent is resting for today. A guided case is ready instead.");
  }
  console.error("Guest opponent failed:", error instanceof Error ? error.message : "unknown");
  return fallback(503, "provider_error", "The opponent couldn't answer. Try again, or carry on with a guided challenge.");
}

function turnParams(ctx: GuestTurnContext) {
  const isRetestChallenge = ctx.userTurns === GUEST_LIVE_ROUNDS;
  const directive = [
    turnDirective(ctx.persona, "challenging", "sprint", ctx.userTurns === GUEST_LIVE_ROUNDS - 1),
    isRetestChallenge ? GUEST_LIVE_RETEST_DIRECTIVE : "",
  ]
    .filter(Boolean)
    .join(" ");
  const latest = ctx.history[ctx.history.length - 1];
  return {
    topicTitle: ctx.topic.title,
    topicPrompt: ctx.topic.prompt,
    userSide: ctx.side,
    history: ctx.history.slice(0, -1),
    latestUserMessage: latest.text,
    directive,
  };
}

async function countMilestone(ctx: GuestTurnContext) {
  if (ctx.userTurns === 0) await recordGuestSprint("started");
  else if (ctx.userTurns === GUEST_LIVE_ROUNDS) await recordGuestSprint("completed");
}

async function opening(ctx: GuestTurnContext): Promise<Response> {
  try {
    const aiMessage = await debateOpening({
      topicTitle: ctx.topic.title,
      topicPrompt: ctx.topic.prompt,
      aiSide: ctx.side === "for" ? "against" : "for",
      directive: openingDirective(ctx.persona, "challenging", "sprint"),
    });
    await countMilestone(ctx);
    return NextResponse.json({ aiMessage }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failureResponse(error);
  }
}

async function jsonTurn(ctx: GuestTurnContext): Promise<Response> {
  try {
    // Only the opponent's move is returned; the model's private feedback
    // field is discarded (guest feedback is the local deterministic check).
    const { aiMessage } = await debateTurn(turnParams(ctx));
    await countMilestone(ctx);
    return NextResponse.json({ aiMessage }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failureResponse(error);
  }
}

function streamTurn(ctx: GuestTurnContext): Response {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
        } catch {
          closed = true;
        }
      };
      const keepAlive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          closed = true;
        }
      }, 10_000);

      send("start", {});
      void (async () => {
        let result: { status: number; body: unknown };
        try {
          const streamed = await debateTurnStream(turnParams(ctx), {
            onDelta: (text) => {
              if (text) send("delta", { text });
            },
            onReset: () => send("reset", {}),
          });
          result = { status: 200, body: { aiMessage: streamed.result.aiMessage } };
          await countMilestone(ctx);
        } catch (error) {
          const response = failureResponse(error);
          result = { status: response.status, body: await response.json() };
        }
        clearInterval(keepAlive);
        send("result", result);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed by the client
          }
        }
      })();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(request: Request) {
  const prepared = await prepare(request);
  if ("response" in prepared) return prepared.response;
  const { ctx } = prepared;
  if (ctx.userTurns === 0) return opening(ctx);
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/event-stream") ? streamTurn(ctx) : jsonTurn(ctx);
}
