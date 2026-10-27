/**
 * The Today header's stat pills.
 *
 * A brand-new account used to open on "🔥 0-day streak · Level 1 · 0 pts":
 * three zero-value badges for things the user has not done yet, crowding the
 * first screen before the one thing that matters (start today's debate).
 * A pill only appears once it says something: the streak once there is one,
 * level and points once any points have been earned.
 */
export interface HomeHeaderProfile {
  current_streak: number;
  level: number;
  total_points: number;
}

export function homeHeaderPills(profile: HomeHeaderProfile | null | undefined): string[] {
  if (!profile) return [];
  const pills: string[] = [];
  if (profile.current_streak > 0) pills.push(`${profile.current_streak}-day streak`);
  if (profile.total_points > 0) {
    pills.push(`Level ${profile.level}`);
    pills.push(`${profile.total_points} pts`);
  }
  return pills;
}
