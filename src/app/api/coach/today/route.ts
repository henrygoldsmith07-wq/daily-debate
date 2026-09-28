import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/backend/server";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  buildCoachProfile,
  DIMENSION_LABELS,
  selectFocus,
  todaysDrill,
  type CoachDim,
} from "@/lib/adaptiveCoach";
import { loadCoachingContext } from "@/lib/coachingContextServer";
import { getTodayTopic } from "@/lib/dailyTopic";
import { getCurrentUser } from "@/lib/currentViewer";
import { dateKeyInTimeZone, normalizeIanaTimeZone } from "@/lib/timeZone";

type DrillAssignmentRow = {
  id: string;
  user_id: string;
  dimension: string;
  minutes: number;
  title: string;
  prompt: string;
  assigned_date: string;
  before_score: number | null;
  attempt_text: string | null;
  attempt_score: number | null;
  movement: number | null;
  status: string;
  created_at: string;
};

type DrillProposal = {
  dimension: string;
  minutes: number;
  title: string;
  prompt: string;
  beforeScore: number | null;
};

type CoachTodayState = {
  service: ReturnType<typeof createServiceClient>;
  profile: ReturnType<typeof buildCoachProfile>["dims"];
  focusReason: string;
  proposal: DrillProposal | null;
  existing: DrillAssignmentRow | null;
  activationRequired: boolean;
  retest: {
    dimension: string;
    label: string;
    repairDebateId: string;
    attemptedAt: string;
  } | null;
  debatesAnalysed: number;
  coachingStatus: "ok" | "partial" | "unavailable";
  degradationReasons: string[];
  today: string;
};

class CoachTodayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function loadCoachTodayState(userId: string): Promise<CoachTodayState> {
  const topic = await getTodayTopic();
  const context = await loadCoachingContext(userId, { currentTopicId: topic.id });
  if (!context.ledger) {
    throw new CoachTodayError("Coaching context is temporarily unavailable.", 503, {
      coachingStatus: context.status,
      degradationReasons: context.degradationReasons,
    });
  }

  const service = createServiceClient();
  const { data: profileRow, error: profileError } = await service
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .single();
  if (profileError || !profileRow?.timezone) {
    throw new CoachTodayError("Your local training day is temporarily unavailable. Try again shortly.", 503);
  }
  const timeZone = normalizeIanaTimeZone(profileRow.timezone);
  if (timeZone !== profileRow.timezone) {
    throw new CoachTodayError("Your local training day is temporarily unavailable. Try again shortly.", 503);
  }

  const ledger = context.ledger;
  const outcomes = context.drillOutcomes;
  const pendingRetest = context.selectedRetest;
  const { dims, slopes } = buildCoachProfile(ledger.points);

  let focus: CoachDim | null;
  let focusReason: string;
  if (pendingRetest) {
    focus =
      dims.find((d) => d.key === pendingRetest.dimension) ?? {
        key: pendingRetest.dimension,
        label: DIMENSION_LABELS[pendingRetest.dimension],
        score: null,
        hasData: false,
      };
    focusReason = "deliberate retest after your repair";
  } else {
    const selected = selectFocus(dims, slopes, outcomes);
    focus = selected.focus;
    focusReason = selected.reason;
  }

  const today = dateKeyInTimeZone(timeZone);
  const { data: existingRow, error: existingError } = await service
    .from("drill_assignments")
    .select("*")
    .eq("user_id", userId)
    .eq("assigned_date", today)
    .maybeSingle();
  if (existingError) {
    throw new CoachTodayError("Training assignment is temporarily unavailable.", 503);
  }

  const existing = (existingRow ?? null) as DrillAssignmentRow | null;
  const drill = focus ? todaysDrill(focus.key, `${today}T12:00:00.000Z`) : null;
  const proposal: DrillProposal | null = focus && drill
    ? {
        dimension: focus.key,
        minutes: drill.minutes,
        title: drill.title,
        prompt: drill.prompt,
        beforeScore: focus.score,
      }
    : null;

  // GET is deliberately read-only. A missing assignment, or an open generic
  // drill that a newly-pending repair wants to retarget, is only persisted
  // after the learner explicitly activates it with POST.
  const retargetNeeded = !!(
    existing &&
    pendingRetest &&
    existing.status === "open" &&
    focus &&
    existing.dimension !== focus.key
  );
  const activationRequired = !!proposal && (!existing || retargetNeeded);

  return {
    service,
    profile: dims,
    focusReason,
    proposal: activationRequired ? proposal : null,
    existing: retargetNeeded ? null : existing,
    activationRequired,
    retest: pendingRetest
      ? {
          dimension: pendingRetest.dimension,
          label: DIMENSION_LABELS[pendingRetest.dimension],
          repairDebateId: pendingRetest.debateId,
          attemptedAt: pendingRetest.attemptedAt,
        }
      : null,
    debatesAnalysed: ledger.debates,
    coachingStatus: context.status,
    degradationReasons: context.degradationReasons,
    today,
  };
}

function errorResponse(error: unknown) {
  if (error instanceof CoachTodayError) {
    return NextResponse.json(
      { error: error.message, ...error.payload },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  console.error("Failed to load today's coaching state:", error);
  return NextResponse.json(
    { error: "Coach unavailable." },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}

// Reading today's coach is safe and repeatable: no assignment creation,
// retargeting, or derived-outcome persistence happens in GET.
export async function GET(request: Request) {
  const limited = await checkRateLimit(request, { name: "coach-today", limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const state = await loadCoachTodayState(user.id);
    return NextResponse.json(
      {
        profile: state.profile,
        focusReason: state.focusReason,
        assignment: state.existing,
        proposal: state.proposal,
        activationRequired: state.activationRequired,
        retest: state.retest,
        debatesAnalysed: state.debatesAnalysed,
        coachingStatus: state.coachingStatus,
        degradationReasons: state.degradationReasons,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

// Assignment creation/retargeting is an explicit command. The server
// recomputes the desired focus instead of trusting a client-supplied drill.
export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { name: "coach-today-activate", limit: 12, windowMs: 60_000 });
  if (limited) return limited;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const state = await loadCoachTodayState(user.id);

    if (!state.activationRequired || !state.proposal) {
      return NextResponse.json(
        {
          assignment: state.existing,
          proposal: null,
          activationRequired: false,
          focusReason: state.focusReason,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const proposal = state.proposal;
    const { data: current, error: currentError } = await state.service
      .from("drill_assignments")
      .select("*")
      .eq("user_id", user.id)
      .eq("assigned_date", state.today)
      .maybeSingle();
    if (currentError) {
      throw new CoachTodayError("Training assignment is temporarily unavailable.", 503);
    }

    let assignment: DrillAssignmentRow | null = null;
    if (current) {
      // Preserve attempted work as history. Only an open same-day assignment
      // may be retargeted, and only to the server's current desired focus.
      if (current.status !== "open") {
        assignment = current as DrillAssignmentRow;
      } else {
        const { data: retargeted, error } = await state.service
          .from("drill_assignments")
          .update({
            dimension: proposal.dimension,
            minutes: proposal.minutes,
            title: proposal.title,
            prompt: proposal.prompt,
            before_score: proposal.beforeScore,
          })
          .eq("id", current.id)
          .eq("user_id", user.id)
          .eq("status", "open")
          .select("*")
          .single();
        if (error || !retargeted) {
          console.error("Failed to activate retargeted coaching assignment:", error);
          throw new CoachTodayError("Failed to update the training assignment.", 503);
        }
        assignment = retargeted as DrillAssignmentRow;
      }
    } else {
      const { data: created, error } = await state.service
        .from("drill_assignments")
        .insert({
          user_id: user.id,
          dimension: proposal.dimension,
          minutes: proposal.minutes,
          title: proposal.title,
          prompt: proposal.prompt,
          assigned_date: state.today,
          before_score: proposal.beforeScore,
        })
        .select("*")
        .single();

      if (error?.code === "23505") {
        // Another explicit activation won the unique (user, local-day) race.
        const { data: winner, error: winnerError } = await state.service
          .from("drill_assignments")
          .select("*")
          .eq("user_id", user.id)
          .eq("assigned_date", state.today)
          .maybeSingle();
        if (winnerError || !winner) {
          console.error("Failed to re-read concurrent training assignment:", winnerError ?? error);
          throw new CoachTodayError("Failed to create training assignment.", 500);
        }
        assignment = winner as DrillAssignmentRow;
      } else if (error || !created) {
        console.error("Failed to create training assignment:", error);
        throw new CoachTodayError("Failed to create training assignment.", 500);
      } else {
        assignment = created as DrillAssignmentRow;
      }
    }

    return NextResponse.json(
      {
        assignment,
        proposal: null,
        activationRequired: false,
        focusReason: state.focusReason,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
