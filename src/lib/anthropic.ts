import Anthropic from "@anthropic-ai/sdk";
import type { ArgGraph } from "./argGraph";
import type { DebateSide, DebateSummary, TopicSource, TurnScores } from "./types";
import { finalizePvpAssessment } from "./observableAssessment";

// Lazy import to avoid circular deps: types -> argGraph ok, but anthropic -> types is fine.
// ArgGraph types are structural; runtime validation via argGraph.validateGraph.

const MODEL = "claude-sonnet-5";

function getClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured.");
  return new Anthropic({ apiKey: key });
}

export interface GeneratedTopic {
  title: string;
  prompt: string;
  category: string;
  sources: TopicSource[];
}

const TOPIC_TOOL = {
  name: "emit_daily_topic",
  description: "Return today's debate topic for a critical-thinking practice app.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: { type: "string", description: "Short, punchy title for the topic (under 10 words)." },
      prompt: {
        type: "string",
        description: "A one or two sentence debate proposition/question, phrased neutrally so it can be argued from either side.",
      },
      category: {
        type: "string",
        description: "One word/short phrase category, e.g. Technology, Ethics, Politics, Science, Economics.",
      },
      sources: {
        type: "array",
        description: "3-5 well-known, credible, real institutions or outlets (never invent deep-link URLs) whose reporting or research bears on this topic, each with the angle/data they're known for.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Name of the real institution/outlet, e.g. Pew Research Center." },
            homepage: { type: "string", description: "Its real root homepage URL, e.g. https://www.pewresearch.org" },
            angle: { type: "string", description: "One sentence on what perspective or data this source is known for on the topic." },
          },
          required: ["name", "homepage", "angle"],
        },
      },
    },
    required: ["title", "prompt", "category", "sources"],
  },
};

export async function generateDailyTopic(recentTitles: string[]): Promise<GeneratedTopic> {
  const anthropic = getClient();
  const avoid = recentTitles.length ? `Avoid repeating or closely resembling these recent topics: ${recentTitles.join("; ")}.` : "";

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [TOPIC_TOOL],
    tool_choice: { type: "tool", name: TOPIC_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Pick today's debate topic for a daily critical-thinking app used by the general public. It should be genuinely debatable (reasonable people disagree), civically or intellectually meaningful, and not needlessly inflammatory or a pure culture-war flashpoint. Draw from technology, science, ethics, economics, education, or public policy. ${avoid} Ground it with 3-5 real, well-known, credible institutions (never fabricate a specific article URL — only real root homepages) relevant to the topic.`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("Claude did not return structured output");
  return toolUse.input as GeneratedTopic;
}

export interface DebateTurnResult {
  aiMessage: string;
  /** Back-compat only. The route computes scores from observable features. */
  scores?: TurnScores;
  feedback: string;
}

const TURN_TOOL = {
  name: "emit_debate_turn",
  description: "Score the user's latest debate response and produce the AI opponent's next rebuttal or probing question.",
  input_schema: {
    type: "object" as const,
    properties: {
      feedback: { type: "string", description: "One or two sentences of specific, constructive feedback on this response." },
      aiMessage: {
        type: "string",
        description: "The AI opponent's next move: a sharp counter-argument, a probing follow-up question, or a challenge to a weak point — 2-4 sentences, arguing the opposite side from the user.",
      },
    },
    required: ["feedback", "aiMessage"],
  },
};

export async function debateTurn(params: {
  topicTitle: string;
  topicPrompt: string;
  userSide: DebateSide;
  history: { role: "ai" | "user"; text: string }[];
  latestUserMessage: string;
}): Promise<DebateTurnResult> {
  const anthropic = getClient();
  const aiSide: DebateSide = params.userSide === "for" ? "against" : "for";

  const transcript = params.history.map((turn) => `${turn.role === "ai" ? "AI (opposing)" : "User"}: ${turn.text}`).join("\n");

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [TURN_TOOL],
    tool_choice: { type: "tool", name: TURN_TOOL.name },
    messages: [
      {
        role: "user",
        content: `You are an AI debate opponent in a critical-thinking training app. Topic: "${params.topicTitle}" — ${params.topicPrompt}\nThe user is arguing the "${params.userSide}" side. You are arguing the "${aiSide}" side, and your job is to challenge the user's thinking as rigorously and fairly as possible so they sharpen their reasoning.\n\nTranscript so far:\n${transcript}\n\nUser's latest response: "${params.latestUserMessage}"\n\nGive brief, specific feedback and produce your next challenge. Do not assign numeric scores; the application computes those from observable argument evidence after this response.`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("Claude did not return structured output");
  return toolUse.input as DebateTurnResult;
}

const OPENING_TOOL = {
  name: "emit_opening",
  description: "Open a debate by arguing the given side in 2-4 sentences.",
  input_schema: {
    type: "object" as const,
    properties: { aiMessage: { type: "string", description: "Opening argument, 2-4 sentences." } },
    required: ["aiMessage"],
  },
};

export async function debateOpening(params: { topicTitle: string; topicPrompt: string; aiSide: DebateSide }): Promise<string> {
  const anthropic = getClient();
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    tools: [OPENING_TOOL],
    tool_choice: { type: "tool", name: OPENING_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Open a debate on "${params.topicTitle}" — ${params.topicPrompt}\nArgue the "${params.aiSide}" side in 2-4 sentences, stating a clear, specific opening claim (not a vague restatement of the prompt).`,
      },
    ],
  });
  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("Claude did not return structured output");
  return (toolUse.input as { aiMessage: string }).aiMessage;
}

const SUMMARY_TOOL = {
  name: "emit_summary",
  description: "Summarize a completed debate practice session for the user.",
  input_schema: {
    type: "object" as const,
    properties: {
      overallFeedback: { type: "string", description: "2-3 sentence overall assessment of the user's reasoning across the session." },
      strengths: { type: "array", items: { type: "string" }, description: "1-3 short specific strengths." },
      improvements: { type: "array", items: { type: "string" }, description: "1-3 short specific things to improve." },
    },
    required: ["overallFeedback", "strengths", "improvements"],
  },
};

export async function summarizeSoloDebate(params: { topicTitle: string; transcript: string }): Promise<DebateSummary> {
  const anthropic = getClient();
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 768,
    tools: [SUMMARY_TOOL],
    tool_choice: { type: "tool", name: SUMMARY_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Here is a full debate practice transcript on "${params.topicTitle}":\n\n${params.transcript}\n\nGive the user a short overall assessment of their critical-thinking performance, with specific strengths and areas to improve.`,
      },
    ],
  });
  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("Claude did not return structured output");
  const ret = toolUse.input as DebateSummary;
  // New optional field: if the model returns argGraph, keep it; otherwise leave undefined.
  return ret;
}

export interface PvpJudgeResult {
  winner: "a" | "b" | "tie";
  playerAScore: number;
  playerBScore: number;
  rationale: string;
  argGraph?: ArgGraph;
  breakdown?: { a: { claims: number; evidence: number; rebuttals: number; impacts: number; fallacies: number; droppedSuffered: number }; b: { claims: number; evidence: number; rebuttals: number; impacts: number; fallacies: number; droppedSuffered: number } };
  decidingFactor?: string;
  scoreStatus?: import("./observableAssessment").AssessmentStatus;
  observableAssessment?: import("./observableAssessment").ObservableAssessment;
}

const JUDGE_TOOL = {
  name: "emit_verdict",
  description: "Act as a neutral judge on a completed player-vs-player debate, producing both the verdict and a structured argument graph so the UI can show why the winner won.",
  input_schema: {
    type: "object" as const,
    properties: {
      rationale: { type: "string", description: "2-4 sentences explaining the verdict, citing specific moments from the transcript." },
      decidingFactor: { type: "string", description: "One sentence naming the single biggest reason the winner won (e.g. 'Player A's strongest impact went unrebutted while Player B left two claims unsupported')." },
      breakdown: {
        type: "object",
        description: "Short tallies so the UI can compare sides without parsing prose.",
        properties: {
          a: {
            type: "object",
            properties: {
              claims: { type: "integer", description: "Number of distinct claims made by A." },
              evidence: { type: "integer", description: "Number of evidence-backed supports by A." },
              rebuttals: { type: "integer", description: "Number of direct rebuttals by A." },
              impacts: { type: "integer", description: "Number of impact/framing moves by A." },
              fallacies: { type: "integer", description: "Number of fallacious moves by A." },
              droppedSuffered: { type: "integer", description: "How many of A's arguments were dropped (unanswered) by B." },
            },
            required: ["claims", "evidence", "rebuttals", "impacts", "fallacies", "droppedSuffered"],
          },
          b: {
            type: "object",
            properties: {
              claims: { type: "integer", description: "Number of distinct claims made by B." },
              evidence: { type: "integer", description: "Number of evidence-backed supports by B." },
              rebuttals: { type: "integer", description: "Number of direct rebuttals by B." },
              impacts: { type: "integer", description: "Number of impact/framing moves by B." },
              fallacies: { type: "integer", description: "Number of fallacious moves by B." },
              droppedSuffered: { type: "integer", description: "How many of B's arguments were dropped (unanswered) by A." },
            },
            required: ["claims", "evidence", "rebuttals", "impacts", "fallacies", "droppedSuffered"],
          },
        },
        required: ["a", "b"],
      },
      argGraph: {
        type: "object",
        description: "The full argument graph. Keep every text field concise (≤18 words). cited/strong evidence must carry citations.",
        properties: {
          nodes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Stable id like c1, e1, k1, r1, i1." },
                kind: { type: "string", enum: ["claim", "evidence", "counterclaim", "rebuttal", "impact"] },
                owner: { type: "string", enum: ["a", "b", "ai"] },
                text: { type: "string", description: "One-sentence summary of the node." },
                round: { type: "integer", description: "Round number where this was introduced." },
                evidenceStrength: { type: "string", enum: ["anecdotal", "general", "cited", "strong"] },
                citations: {
                  type: "array",
                  description: "Source grounding for this node. cited/strong evidence MUST include ≥1 citation.",
                  items: {
                    type: "object",
                    properties: {
                      sourceName: { type: "string", description: "Real institution/outlet, e.g. Pew Research Center." },
                      homepage: { type: "string", description: "Root homepage only, e.g. https://www.pewresearch.org" },
                      excerpt: { type: "string", description: "≤200 chars: what the source is known for." },
                    },
                    required: ["sourceName"],
                  },
                },
                targets: { type: "array", items: { type: "string" }, description: "For rebuttals: node ids rebutted." },
                fallacy: {
                  type: "string",
                  enum: ["strawman", "ad_hominem", "false_dilemma", "slippery_slope", "appeal_to_emotion", "hasty_generalization", "appeal_to_authority", "whataboutism", "begging_the_question", "equivocation", "none"],
                },
              },
              required: ["id", "kind", "owner", "text", "round"],
            },
          },
          edges: {
            type: "array",
            items: {
              type: "object",
              properties: {
                from: { type: "string" },
                to: { type: "string" },
                relation: { type: "string", enum: ["supports", "counters", "rebuts", "impacts"] },
              },
              required: ["from", "to", "relation"],
            },
          },
          dropped: {
            type: "array",
            items: {
              type: "object",
              properties: {
                nodeId: { type: "string" },
                text: { type: "string" },
                owner: { type: "string", enum: ["a", "b", "ai"] },
                round: { type: "integer" },
              },
              required: ["nodeId", "text", "owner", "round"],
            },
          },
          contradictions: {
            type: "array",
            items: {
              type: "object",
              properties: { a: { type: "string" }, b: { type: "string" }, explanation: { type: "string" }, owner: { type: "string", enum: ["a", "b", "ai"] } },
              required: ["a", "b", "explanation", "owner"],
            },
          },
          concessions: {
            type: "array",
            items: {
              type: "object",
              properties: { nodeId: { type: "string" }, by: { type: "string", enum: ["a", "b", "ai"] }, note: { type: "string" } },
              required: ["nodeId", "by", "note"],
            },
          },
          fallacies: {
            type: "array",
            items: {
              type: "object",
              properties: { nodeId: { type: "string" }, fallacy: { type: "string", enum: ["strawman", "ad_hominem", "false_dilemma", "slippery_slope", "appeal_to_emotion", "hasty_generalization", "appeal_to_authority", "whataboutism", "begging_the_question", "equivocation", "none"] }, note: { type: "string" } },
              required: ["nodeId", "fallacy", "note"],
            },
          },
          evidenceStats: {
            type: "object",
            properties: {
              total: { type: "integer" },
              byOwner: {
                type: "object",
                properties: { a: { type: "integer" }, b: { type: "integer" }, ai: { type: "integer" } },
                required: ["a", "b", "ai"],
              },
              byStrength: {
                type: "object",
                properties: { anecdotal: { type: "integer" }, general: { type: "integer" }, cited: { type: "integer" }, strong: { type: "integer" } },
                required: ["anecdotal", "general", "cited", "strong"],
              },
              unsupportedClaimIds: { type: "array", items: { type: "string" } },
            },
            required: ["total", "byOwner", "byStrength", "unsupportedClaimIds"],
          },
          impactComparison: {
            type: "object",
            properties: { a: { type: "integer" }, b: { type: "integer" }, rationale: { type: "string" } },
            required: ["a", "b", "rationale"],
          },
        },
        required: ["nodes", "edges", "dropped", "contradictions", "concessions", "fallacies", "evidenceStats", "impactComparison"],
      },
    },
    required: ["rationale", "argGraph"],
  },
};

export async function judgePvpMatch(params: { topicTitle: string; topicPrompt: string; playerASide: DebateSide; transcript: string }): Promise<PvpJudgeResult> {
  const anthropic = getClient();
  const instructions = `You are a neutral, rigorous debate judge for a critical-thinking app.

Topic: "${params.topicTitle}" — ${params.topicPrompt}
Player A argued "${params.playerASide}"; Player B argued the opposite side.

Transcript:
${params.transcript}

Analyze observable argument structure, not which side of the topic is "correct".
Return a faithful argGraph with nodes (c1,e1,k1,r1,i1, text ≤18 words), edges, dropped arguments, contradictions, concessions, fallacies, evidenceStats, and impactComparison. Every cited/strong evidence node MUST include a citation object with a named source; never invent arguments or citations not present in the transcript. Also return a short rationale citing specific graph moments. Numeric scores and winner are computed by the application from the graph and must not be estimated here.`;

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [JUDGE_TOOL],
    tool_choice: { type: "tool", name: JUDGE_TOOL.name },
    messages: [{ role: "user", content: instructions }],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("Claude did not return structured output");
  const extracted = toolUse.input as { rationale?: string; argGraph?: ArgGraph };
  return finalizePvpAssessment(extracted, { extractionSource: "llm" });
}

