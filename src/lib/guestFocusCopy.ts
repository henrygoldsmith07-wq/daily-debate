// Dependency-free copy + view types for the guest-seeded first focus, so the
// client home card can import them without pulling the coach into the
// browser bundle. Logic lives in guestFocus.ts.

/** The label shown wherever the guest-seeded focus appears. */
export const GUEST_FOCUS_LABEL = "From your guest practice — unvalidated";
/** The label once the learner picks a different focus themselves. */
export const LEARNER_FOCUS_LABEL = "Your pick for this debate";
/** Wire value for "no focus for this debate". */
export const NO_FIRST_FOCUS = "none";

export interface FirstFocusOption {
  key: string;
  headline: string;
}

export interface FirstFocusView {
  /** The guest-seeded dimension, pre-selected. */
  suggested: string;
  label: string;
  /** Every focus the learner may switch to (skills under silent test removed). */
  options: FirstFocusOption[];
}
