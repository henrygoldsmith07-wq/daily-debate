// Retention loops beyond streaks: quests, comebacks, weekly targets.

export interface Quest { id: string; label: string; target: number; done: number; }
export function dailyQuests(completedDebatesToday: number, rebuttalsToday: number): Quest[] {
  return [
    { id: "q-debate", label: "Complete a debate", target: 1, done: Math.min(1, completedDebatesToday) },
    { id: "q-rebuttal", label: "Make 3 rebuttals", target: 3, done: Math.min(3, rebuttalsToday) },
  ];
}

export function weeklyTarget(totalPoints: number, weeklyGoal=300): { progress: number; pct: number } {
  return { progress: totalPoints, pct: Math.min(1, totalPoints / weeklyGoal) };
}

export function comebackCopy(lastActivityIso: string|null, todayIso: string): string | null {
  if (!lastActivityIso) return null;
  const d = Math.round((new Date(todayIso).getTime() - new Date(lastActivityIso).getTime())/86400000);
  if (d===2) return "Back after a day off — your streak is waiting.";
  if (d>7) return "Welcome back — pick a quick 1-round warm-up to get sharp again.";
  return null;
}

export interface OnboardingChecklist { steps: Array<{ id: string; label: string; done: boolean }> }
export function onboardingChecklist(opts: { hasDebated: boolean; hasTriedVoice: boolean; hasSeenGraph: boolean }): OnboardingChecklist {
  return { steps: [
    { id: "debate", label: "Finish your first 5-round debate", done: opts.hasDebated },
    { id: "voice", label: "Try voice input", done: opts.hasTriedVoice },
    { id: "graph", label: "Open the argument graph", done: opts.hasSeenGraph },
  ]};
}
