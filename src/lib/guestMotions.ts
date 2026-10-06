// Curated motions for guest practice.
//
// Guest mode is deterministic on purpose: no AI call, no provider cost, and
// the same motion for the same day on every device, so a screenshot or a test
// stays meaningful.
//
// Each motion carries its own three-round scripted opposing case. The rounds
// escalate the same tension rather than introducing unrelated points, because
// the repair step later asks the learner to rewrite a move from this specific
// argument - the repair prompt is only meaningful against a real opponent.

export interface GuestMotionRound {
  label: string;
  opponent: string;
  prompt: string;
}

export interface GuestMotion {
  /** Stable slug; also the rotation key. */
  id: string;
  motion: string;
  topic: string;
  /** One coaching focus for the day, matching the daily-practice promise. */
  coachingFocus: string;
  rounds: [GuestMotionRound, GuestMotionRound, GuestMotionRound];
}

export const GUEST_MOTIONS: readonly GuestMotion[] = [
  {
    id: "phone-free-hour",
    motion: "Should every school day include a phone-free hour?",
    topic: "Education",
    coachingFocus: "Make the reasoning visible.",
    rounds: [
      {
        label: "Make your case",
        opponent:
          "A phone-free hour gives students room to focus, talk, and reset without another notification competing for attention.",
        prompt: "Open with one clear claim and the reason it matters.",
      },
      {
        label: "Take the pressure",
        opponent:
          "A blanket rule sounds simple, but it can punish students who need a phone for accessibility, family care, or a safe trip home.",
        prompt: "Address the strongest objection before it addresses you.",
      },
      {
        label: "Close with impact",
        opponent:
          "The best policy is not the strictest one. It is the one students can follow while teachers can still protect learning time.",
        prompt: "Compare the trade-offs and make your recommendation.",
      },
    ],
  },
  {
    id: "four-day-week",
    motion: "Should employers move to a four-day working week?",
    topic: "Work",
    coachingFocus: "Compare consequences instead of listing them.",
    rounds: [
      {
        label: "Make your case",
        opponent:
          "Compressed weeks concentrate the same work into fewer days, which can return the time workers say they have lost to meetings and commuting.",
        prompt: "Open with one clear claim and the reason it matters.",
      },
      {
        label: "Take the pressure",
        opponent:
          "Not every role compresses safely. Cover desks, care work, and shift-based jobs lose coverage rather than gain rest when the hours simply get tighter.",
        prompt: "Address the strongest objection before it addresses you.",
      },
      {
        label: "Close with impact",
        opponent:
          "A policy that helps some workers and quietly breaks others is not a working policy, so the design matters more than the headline.",
        prompt: "Compare the trade-offs and make your recommendation.",
      },
    ],
  },
  {
    id: "city-cars",
    motion: "Should cities ban private cars from their centres?",
    topic: "Cities",
    coachingFocus: "Answer the opponent's actual point.",
    rounds: [
      {
        label: "Make your case",
        opponent:
          "Removing cars from city centres frees road space for walking, cycling, and buses, which is the cheapest way to cut urban emissions.",
        prompt: "Open with one clear claim and the reason it matters.",
      },
      {
        label: "Take the pressure",
        opponent:
          "Restrictions fall hardest on people who cannot afford to live near transit, and on tradespeople whose tools cannot travel on a bus.",
        prompt: "Address the strongest objection before it addresses you.",
      },
      {
        label: "Close with impact",
        opponent:
          "The question is not cars or no cars; it is which restriction keeps the benefits without pushing the cost onto the least mobile residents.",
        prompt: "Compare the trade-offs and make your recommendation.",
      },
    ],
  },
  {
    id: "homework-late",
    motion: "Should schools remove homework for younger pupils?",
    topic: "Education",
    coachingFocus: "Support a factual claim with a real source.",
    rounds: [
      {
        label: "Make your case",
        opponent:
          "Homework set early teaches young pupils to manage their own time, a skill the classroom alone does not practise.",
        prompt: "Open with one clear claim and the reason it matters.",
      },
      {
        label: "Take the pressure",
        opponent:
          "For some pupils homework is the only quiet, supervised space they have to complete work, so removing it widens a gap rather than closing one.",
        prompt: "Address the strongest objection before it addresses you.",
      },
      {
        label: "Close with impact",
        opponent:
          "The evidence on homework volume is mixed enough that the honest answer depends on which outcome a policy is willing to prioritise.",
        prompt: "Compare the trade-offs and make your recommendation.",
      },
    ],
  },
  {
    id: "ai-in-classrooms",
    motion: "Should schools allow AI assistants during in-class work?",
    topic: "Technology",
    coachingFocus: "Connect your claim to a reason.",
    rounds: [
      {
        label: "Make your case",
        opponent:
          "Students already use these tools, so schools would be better to teach with them openly than to pretend the classroom has not changed.",
        prompt: "Open with one clear claim and the reason it matters.",
      },
      {
        label: "Take the pressure",
        opponent:
          "An assistant that finishes the task is not the same as a pupil who learned the skill, and assessment stops measuring what it claims to measure.",
        prompt: "Address the strongest objection before it addresses you.",
      },
      {
        label: "Close with impact",
        opponent:
          "The useful policy depends on whether the goal is passing work or learning to argue, and those goals do not accept the same tools.",
        prompt: "Compare the trade-offs and make your recommendation.",
      },
    ],
  },
  {
    id: "remote-ordinance",
    motion: "Should city councils keep remote working for public-sector roles?",
    topic: "Government",
    coachingFocus: "Name where your evidence comes from.",
    rounds: [
      {
        label: "Make your case",
        opponent:
          "Remote public-sector work widens who can apply, because it removes the commute that decides whether a lower-paid post is viable at all.",
        prompt: "Open with one clear claim and the reason it matters.",
      },
      {
        label: "Take the pressure",
        opponent:
          "The roles hardest to serve remotely are usually the ones serving the people with the least bargaining power to push back.",
        prompt: "Address the strongest objection before it addresses you.",
      },
      {
        label: "Close with impact",
        opponent:
          "A policy that improves access on paper while frontline services quietly degrade is not a win for anyone.",
        prompt: "Compare the trade-offs and make your recommendation.",
      },
    ],
  },
  {
    id: "voting-age",
    motion: "Should the voting age be lowered to sixteen?",
    topic: "Civic life",
    coachingFocus: "Compare the trade-offs and pick a side.",
    rounds: [
      {
        label: "Make your case",
        opponent:
          "Sixteen-year-olds already live with most of the consequences of decisions they cannot vote on, so the argument is about standing, not maturity.",
        prompt: "Open with one clear claim and the reason it matters.",
      },
      {
        label: "Take the pressure",
        opponent:
          "Registration drives in some countries followed first-time voters more than long-term turnout, so a wider franchise can still mean a quieter one.",
        prompt: "Address the strongest objection before it addresses you.",
      },
      {
        label: "Close with impact",
        opponent:
          "The question is which effect a policy is optimising, because the two can point in opposite directions.",
        prompt: "Compare the trade-offs and make your recommendation.",
      },
    ],
  },
] as const;

/**
 * The motion shown on `dayIso` (any `YYYY-MM-DD` string).
 *
 * Deterministic by UTC day so every visitor sees the same motion on the same
 * day - no random rotation, no server state, nothing to cache or pay for.
 */
export function guestMotionForDay(dayIso: string): GuestMotion {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayIso) ? dayIso : new Date().toISOString().slice(0, 10);
  const offset = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
  const index = ((offset % GUEST_MOTIONS.length) + GUEST_MOTIONS.length) % GUEST_MOTIONS.length;
  return GUEST_MOTIONS[index];
}
