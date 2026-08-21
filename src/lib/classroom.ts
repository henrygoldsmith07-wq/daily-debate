// Classroom & team debates + teacher-assigned motions.
// Pure domain state machines — persistence lives in Supabase. These cover the
// roadmap's "team debates / classroom debates / teacher-assigned motions"
// items: a teacher creates a motion, assigns it to a team or class, teams
// accept and run a 2v2 debate, and the dashboard aggregates per-student
// outcomes for the roster only.

export interface TeacherMotion {
  id: string;
  title: string;
  prompt: string;
  category?: string;
  createdBy: string;
  createdAt: string;
  assignedToTeamId?: string;
  assignedToClassId?: string;
}

export interface Classroom {
  id: string;
  name: string;
  teacherId: string;
  studentIds: string[];
}

export interface Team {
  id: string;
  name: string;
  memberIds: string[];
}

export type TeamDebateStatus = "proposed" | "accepted" | "active" | "judged" | "cancelled";

export interface TeamDebate {
  id: string;
  motionId: string;
  teamA: string;
  teamB: string;
  status: TeamDebateStatus;
  winnerTeamId?: string;
  createdAt: string;
}

export function createTeam(id: string, name: string, memberIds: string[]): Team {
  return { id, name, memberIds: [...new Set(memberIds)] };
}

export function validateTeam(t: Team): string[] {
  const errs: string[] = [];
  if (!t.name?.trim()) errs.push("team name required");
  if (t.memberIds.length < 2) errs.push("team needs at least 2 members for a 2v2 debate");
  if (new Set(t.memberIds).size !== t.memberIds.length) errs.push("team members must be distinct");
  return errs;
}

export function assignMotion(motion: TeacherMotion, teamId?: string, classId?: string): TeacherMotion {
  return { ...motion, assignedToTeamId: teamId, assignedToClassId: classId };
}

export function proposeTeamDebate(motionId: string, teamA: string, teamB: string, nowIso = new Date().toISOString()): TeamDebate {
  if (teamA === teamB) throw new Error("team debate needs two distinct teams");
  return { id: `td-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, motionId, teamA, teamB, status: "proposed", createdAt: nowIso };
}

const TEAM_DEBATE_FLOW: Record<TeamDebateStatus, TeamDebateStatus[]> = {
  proposed: ["accepted", "cancelled"],
  accepted: ["active", "cancelled"],
  active: ["judged", "cancelled"],
  judged: [],
  cancelled: [],
};

export function transitionTeamDebate(d: TeamDebate, next: TeamDebateStatus, winnerTeamId?: string): TeamDebate {
  if (!TEAM_DEBATE_FLOW[d.status].includes(next)) throw new Error(`Cannot move team debate ${d.status} → ${next}`);
  if (next === "judged" && !winnerTeamId) throw new Error("judged transition requires winnerTeamId");
  return { ...d, status: next, winnerTeamId: next === "judged" ? winnerTeamId : d.winnerTeamId };
}

export interface StudentResult {
  studentId: string;
  wins: number;
  losses: number;
  ties: number;
  debates: number;
}

export interface ClassroomDashboard {
  byStudent: Record<string, StudentResult>;
  participationRate: number;
}

/** Aggregate judged team debates into per-student results for a class roster. */
export function classroomDashboard(params: {
  classroom: Classroom;
  teams: Team[];
  debates: TeamDebate[];
  results: Array<{ debateId: string; winnerTeamId: string | null }>;
}): ClassroomDashboard {
  const teamById = new Map(params.teams.map((t) => [t.id, t]));
  const debateById = new Map(params.debates.map((d) => [d.id, d]));
  const roster = new Set(params.classroom.studentIds);
  const byStudent: Record<string, StudentResult> = {};
  const ensure = (sid: string) => {
    if (!roster.has(sid)) return null;
    byStudent[sid] ??= { studentId: sid, wins: 0, losses: 0, ties: 0, debates: 0 };
    return byStudent[sid];
  };

  for (const r of params.results) {
    const d = debateById.get(r.debateId);
    if (!d || d.status !== "judged") continue;
    const a = teamById.get(d.teamA);
    const b = teamById.get(d.teamB);
    if (!a || !b) continue;
    for (const sid of [...a.memberIds, ...b.memberIds]) ensure(sid);
    if (r.winnerTeamId === null) {
      for (const sid of [...a.memberIds, ...b.memberIds]) { const s = byStudent[sid]; if (s) { s.ties++; s.debates++; } }
    } else if (r.winnerTeamId === d.teamA) {
      for (const sid of a.memberIds) { const s = byStudent[sid]; if (s) { s.wins++; s.debates++; } }
      for (const sid of b.memberIds) { const s = byStudent[sid]; if (s) { s.losses++; s.debates++; } }
    } else if (r.winnerTeamId === d.teamB) {
      for (const sid of b.memberIds) { const s = byStudent[sid]; if (s) { s.wins++; s.debates++; } }
      for (const sid of a.memberIds) { const s = byStudent[sid]; if (s) { s.losses++; s.debates++; } }
    }
  }
  const participants = Object.keys(byStudent).length;
  const participationRate = roster.size ? participants / roster.size : 0;
  return { byStudent, participationRate };
}
