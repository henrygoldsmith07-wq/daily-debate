import { GoogleGenAI, Type } from "@google/genai";
import type { DebateSide, DebateSummary, TopicSource, TurnScores } from "./types";
import { finalizePvpAssessment } from "./observableAssessment";

const MODEL = "gemini-2.5-flash";

function getClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured.");
  return new GoogleGenAI({ apiKey: key });
}

function parseJson<T>(text: string | undefined): T {
  if (!text) throw new Error("Gemini did not return structured output");
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    // Surface a snippet so 502s are diagnosable from logs alone.
    const snippet = text.slice(0, 200);
    throw new Error(`Gemini returned invalid JSON: ${(error as Error).message} — "${snippet}"`);
  }
}

export interface GeneratedTopic {
  title: string;
  prompt: string;
  category: string;
  sources: TopicSource[];
}

const TOPIC_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: "Short, punchy title for the topic (under 10 words)." },
    prompt: {
      type: Type.STRING,
      description:
        "A one or two sentence debate proposition/question, phrased neutrally so it can be argued from either side.",
    },
    category: {
      type: Type.STRING,
      description: "One word/short phrase category, e.g. Technology, Ethics, Politics, Science, Economics.",
    },
    sources: {
      type: Type.ARRAY,
      description:
        "3-5 well-known, credible, real institutions or outlets (never invent deep-link URLs) whose reporting or research bears on this topic, each with the angle/data they're known for.",
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Name of the real institution/outlet, e.g. Pew Research Center." },
          homepage: { type: Type.STRING, description: "Its real root homepage URL, e.g. https://www.pewresearch.org" },
          angle: { type: Type.STRING, description: "One sentence on what perspective or data this source is known for on the topic." },
        },
        required: ["name", "homepage", "angle"],
      },
    },
  },
  required: ["title", "prompt", "category", "sources"],
};

export async function generateDailyTopic(recentTitles: string[]): Promise<GeneratedTopic> {
  const ai = getClient();
  const avoid = recentTitles.length
    ? `Avoid repeating or closely resembling these recent topics: ${recentTitles.join("; ")}.`
    : "";

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: `Pick today's debate topic for a daily critical-thinking app used by the general public. It should be genuinely debatable (reasonable people disagree), civically or intellectually meaningful, and not needlessly inflammatory or a pure culture-war flashpoint. Draw from technology, science, ethics, economics, education, or public policy. ${avoid} Ground it with 3-5 real, well-known, credible institutions (never fabricate a specific article URL — only real root homepages) relevant to the topic.`,
    config: { responseMimeType: "application/json", responseSchema: TOPIC_SCHEMA },
  });

  return parseJson<GeneratedTopic>(response.text);
}

export interface DebateTurnResult {
  aiMessage: string;
  /** Back-compat only. The route computes scores from observable features. */
  scores?: TurnScores;
  feedback: string;
}

const TURN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    feedback: {
      type: Type.STRING,
      description: "One or two sentences of specific, constructive feedback on this response.",
    },
    aiMessage: {
      type: Type.STRING,
      description:
        "The AI opponent's next move: a sharp counter-argument, a probing follow-up question, or a challenge to a weak point — 2-4 sentences, arguing the opposite side from the user.",
    },
  },
  required: ["feedback", "aiMessage"],
};

export async function debateTurn(params: {
  topicTitle: string;
  topicPrompt: string;
  userSide: DebateSide;
  history: { role: "ai" | "user"; text: string }[];
  latestUserMessage: string;
}): Promise<DebateTurnResult> {
  const ai = getClient();
  const aiSide: DebateSide = params.userSide === "for" ? "against" : "for";

  const transcript = params.history
    .map((turn) => `${turn.role === "ai" ? "AI (opposing)" : "User"}: ${turn.text}`)
    .join("\n");

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: `You are an AI debate opponent in a critical-thinking training app. Topic: "${params.topicTitle}" — ${params.topicPrompt}\nThe user is arguing the "${params.userSide}" side. You are arguing the "${aiSide}" side, and your job is to challenge the user's thinking as rigorously and fairly as possible so they sharpen their reasoning.\n\nTranscript so far:\n${transcript}\n\nUser's latest response: "${params.latestUserMessage}"\n\nGive brief, specific feedback and produce your next challenge. Do not assign numeric scores; the application computes those from observable argument evidence after this response.`,
    config: { responseMimeType: "application/json", responseSchema: TURN_SCHEMA },
  });

  return parseJson<DebateTurnResult>(response.text);
}

const OPENING_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    aiMessage: { type: Type.STRING, description: "Opening argument, 2-4 sentences." },
  },
  required: ["aiMessage"],
};

export async function debateOpening(params: {
  topicTitle: string;
  topicPrompt: string;
  aiSide: DebateSide;
}): Promise<string> {
  const ai = getClient();
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: `Open a debate on "${params.topicTitle}" — ${params.topicPrompt}\nArgue the "${params.aiSide}" side in 2-4 sentences, stating a clear, specific opening claim (not a vague restatement of the prompt).`,
    config: { responseMimeType: "application/json", responseSchema: OPENING_SCHEMA },
  });

  return parseJson<{ aiMessage: string }>(response.text).aiMessage;
}

const SUMMARY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    overallFeedback: { type: Type.STRING, description: "2-3 sentence overall assessment of the user's reasoning across the session." },
    strengths: { type: Type.ARRAY, items: { type: Type.STRING }, description: "1-3 short specific strengths." },
    improvements: { type: Type.ARRAY, items: { type: Type.STRING }, description: "1-3 short specific things to improve." },
  },
  required: ["overallFeedback", "strengths", "improvements"],
};

export async function summarizeSoloDebate(params: {
  topicTitle: string;
  transcript: string;
}): Promise<DebateSummary> {
  const ai = getClient();
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: `Here is a full debate practice transcript on "${params.topicTitle}":\n\n${params.transcript}\n\nGive the user a short overall assessment of their critical-thinking performance, with specific strengths and areas to improve.`,
    config: { responseMimeType: "application/json", responseSchema: SUMMARY_SCHEMA },
  });

  return parseJson<DebateSummary>(response.text);
}

export interface PvpJudgeResult {
  winner: "a" | "b" | "tie";
  playerAScore: number;
  playerBScore: number;
  rationale: string;
  decidingFactor?: string;
  breakdown?: { a: { claims: number; evidence: number; rebuttals: number; impacts: number; fallacies: number; droppedSuffered: number }; b: { claims: number; evidence: number; rebuttals: number; impacts: number; fallacies: number; droppedSuffered: number } };
  argGraph?: import("./argGraph").ArgGraph;
  scoreStatus?: import("./observableAssessment").AssessmentStatus;
  observableAssessment?: import("./observableAssessment").ObservableAssessment;
}

const EVIDENCE_CITATION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    sourceName: { type: Type.STRING, description: "Real institution/outlet name backing this evidence, e.g. 'Pew Research Center'. Must be real; never invent." },
    homepage: { type: Type.STRING, description: "Root homepage URL only, e.g. https://www.pewresearch.org. Never invent article URLs." },
    excerpt: { type: Type.STRING, description: "≤200 chars: what this source is known for or the data point it supports." },
  },
  required: ["sourceName"],
};

const ARG_NODE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING, description: "Stable id like c1, e1, k1, r1, i1." },
    kind: { type: Type.STRING, enum: ["claim", "evidence", "counterclaim", "rebuttal", "impact"] },
    owner: { type: Type.STRING, enum: ["a", "b", "ai"] },
    text: { type: Type.STRING, description: "One-sentence summary (≤18 words)." },
    round: { type: Type.INTEGER, description: "Round where introduced." },
    evidenceStrength: { type: Type.STRING, enum: ["anecdotal", "general", "cited", "strong"] },
    citations: { type: Type.ARRAY, description: "Source grounding for this node. cited/strong evidence MUST include ≥1 citation; anecdotal/general may omit.", items: EVIDENCE_CITATION_SCHEMA },
    targets: { type: Type.ARRAY, items: { type: Type.STRING }, description: "For rebuttals: ids rebutted." },
    fallacy: { type: Type.STRING, enum: ["strawman", "ad_hominem", "false_dilemma", "slippery_slope", "appeal_to_emotion", "hasty_generalization", "appeal_to_authority", "whataboutism", "begging_the_question", "equivocation", "none"] },
  },
  required: ["id", "kind", "owner", "text", "round"],
};

const ARG_GRAPH_SCHEMA = {
  type: Type.OBJECT,
  description: "Full argument graph. Keep every text field concise (≤18 words). cited/strong evidence must carry citations.",
  properties: {
    nodes: { type: Type.ARRAY, items: ARG_NODE_SCHEMA },
    edges: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { from: { type: Type.STRING }, to: { type: Type.STRING }, relation: { type: Type.STRING, enum: ["supports", "counters", "rebuts", "impacts"] } }, required: ["from", "to", "relation"] } },
    dropped: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { nodeId: { type: Type.STRING }, text: { type: Type.STRING }, owner: { type: Type.STRING, enum: ["a", "b", "ai"] }, round: { type: Type.INTEGER } }, required: ["nodeId", "text", "owner", "round"] } },
    contradictions: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { a: { type: Type.STRING }, b: { type: Type.STRING }, explanation: { type: Type.STRING }, owner: { type: Type.STRING, enum: ["a", "b", "ai"] } }, required: ["a", "b", "explanation", "owner"] } },
    concessions: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { nodeId: { type: Type.STRING }, by: { type: Type.STRING, enum: ["a", "b", "ai"] }, note: { type: Type.STRING } }, required: ["nodeId", "by", "note"] } },
    fallacies: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { nodeId: { type: Type.STRING }, fallacy: { type: Type.STRING, enum: ["strawman", "ad_hominem", "false_dilemma", "slippery_slope", "appeal_to_emotion", "hasty_generalization", "appeal_to_authority", "whataboutism", "begging_the_question", "equivocation", "none"] }, note: { type: Type.STRING } }, required: ["nodeId", "fallacy", "note"] } },
    evidenceStats: { type: Type.OBJECT, properties: { total: { type: Type.INTEGER }, byOwner: { type: Type.OBJECT, properties: { a: { type: Type.INTEGER }, b: { type: Type.INTEGER }, ai: { type: Type.INTEGER } }, required: ["a", "b", "ai"] }, byStrength: { type: Type.OBJECT, properties: { anecdotal: { type: Type.INTEGER }, general: { type: Type.INTEGER }, cited: { type: Type.INTEGER }, strong: { type: Type.INTEGER } }, required: ["anecdotal", "general", "cited", "strong"] }, unsupportedClaimIds: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ["total", "byOwner", "byStrength", "unsupportedClaimIds"] },
    impactComparison: { type: Type.OBJECT, properties: { a: { type: Type.INTEGER }, b: { type: Type.INTEGER }, rationale: { type: Type.STRING } }, required: ["a", "b", "rationale"] },
  },
  required: ["nodes", "edges", "dropped", "contradictions", "concessions", "fallacies", "evidenceStats", "impactComparison"],
};

const JUDGE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    rationale: { type: Type.STRING, description: "2-4 sentences, citing specific transcript moments." },
    decidingFactor: { type: Type.STRING, description: "One sentence naming the single biggest reason the winner won." },
    breakdown: { type: Type.OBJECT, properties: { a: { type: Type.OBJECT, properties: { claims: { type: Type.INTEGER }, evidence: { type: Type.INTEGER }, rebuttals: { type: Type.INTEGER }, impacts: { type: Type.INTEGER }, fallacies: { type: Type.INTEGER }, droppedSuffered: { type: Type.INTEGER } }, required: ["claims", "evidence", "rebuttals", "impacts", "fallacies", "droppedSuffered"] }, b: { type: Type.OBJECT, properties: { claims: { type: Type.INTEGER }, evidence: { type: Type.INTEGER }, rebuttals: { type: Type.INTEGER }, impacts: { type: Type.INTEGER }, fallacies: { type: Type.INTEGER }, droppedSuffered: { type: Type.INTEGER } }, required: ["claims", "evidence", "rebuttals", "impacts", "fallacies", "droppedSuffered"] } }, required: ["a", "b"] },
    argGraph: ARG_GRAPH_SCHEMA,
  },
  required: ["rationale", "argGraph"],
};

export async function judgePvpMatch(params: {
  topicTitle: string;
  topicPrompt: string;
  playerASide: DebateSide;
  transcript: string;
}): Promise<PvpJudgeResult> {
  const ai = getClient();
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: `You are a neutral, rigorous debate analyst. Topic: "${params.topicTitle}" — ${params.topicPrompt}\nPlayer A argued "${params.playerASide}"; Player B argued the opposite side.\n\nTranscript:\n${params.transcript}\n\nAnalyze the observable argument structure, not which side of the topic is "correct". Return a faithful argGraph with nodes (c1,e1,k1,r1,i1, text ≤18 words), edges, dropped arguments, contradictions, concessions, fallacies, evidenceStats, and impactComparison. Every cited/strong evidence node MUST include a citation object with a named source; never invent arguments or citations not present in the transcript. Also return a short rationale citing specific graph moments. Numeric scores and winner are computed by the application from the graph and must not be estimated here.`,
    config: { responseMimeType: "application/json", responseSchema: JUDGE_SCHEMA },
  });

  const extracted = parseJson<{ rationale?: string; argGraph?: import("./argGraph").ArgGraph }>(response.text);
  return finalizePvpAssessment(extracted, { extractionSource: "llm" });
}

