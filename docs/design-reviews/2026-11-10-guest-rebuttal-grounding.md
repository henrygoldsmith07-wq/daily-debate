# 2026-11-10 — guest rebuttal grounding

Local branch `feat/guest-first-practice`, HEAD `daf32c7`, expected origin. Read instructions, README, complete existing diff, recent commits, prior outcome/history and recovery notes. Existing onboarding and retest-persistence work preserved. `fix/guest-final-round-recovery` points to the same HEAD; both contain the post-hydration storage gate. No existing Daily Debate server was running.

## Implemented — high confidence, medium impact, small scope

The shared guest inspector accepted any opposing-move marker with no content overlap. Therefore an answer naming an unrelated concern could pass round feedback, repair and retest. Require two shared content words with a marker, or the existing three-word overlap route. All three callers use this inspector. Evidence: `src/lib/guestAssessment.ts:119,127,271,340`. This closes the marker-only shortcut; it does not validate rebuttal quality. Paraphrases may be missed; copying challenge words can still pass.

Retest success now describes detected text cues rather than a live debate or demonstrated transfer. Aligned the completion screen and removed its claim that repeated account measurements establish ability. A failed retest now offers Revise this response, retaining the existing draft through the persisted attempt state. Evidence: `src/components/GuestArena.tsx:901,953,958,966,1035,1048,1053`.

## Verification

- Full lint (zero warnings), type-check, production build (38 static pages), and whitespace checks passed. Repeated after completion-screen wording changed. No automated tests added or run; benchmark gates unchanged.
- Manual production-browser walkthrough using a synthetic guided retest snapshot, not a real learner record. Current challenge: newer staff learning by observing experienced colleagues. An answer about service targets/online appointments now gets Not observed; previously the marker-only branch would accept it. Revise retained that answer. Replaced it with an answer explicitly addressing newer staff, colleagues and mentoring; reload retained the revision, submission detected the cues.
- Desktop 1280x900 requested (1265 CSS width); mobile 390x844 requested (375 CSS width). Submitted feedback survived mobile reload; no horizontal overflow measured. Finish and reload retained completion. Final rebuilt completion wording inspected on mobile. No hydration errors reported in browser diagnostics.
- Earlier final-round recovery walkthrough was not repeated: unchanged hydration gate and persistence code were reviewed and prior verification consulted. This run exercised restored retest and completion state. Browser back/forward, account/provider failures, blocked/corrupt storage, paraphrase accuracy and overall scoring validity remain unchecked.
- Production previews stopped; created tab closed. Build/TypeScript caches refreshed. Initial Python edit attempt failed because Python is unavailable; no files changed by it. Used patch/PowerShell instead. No dependency, secret, commit, push or deployment changes.

## Remaining

Guest assessment remains partial and unvalidated. Lexical grounding is a conservative relevance filter, not semantic scoring or learning evidence. Account engagement scoring uses its separate existing surface rubric and was not changed. Other signup/result copy still merits an evidence-claims audit; this run does not establish account measurement validity.
