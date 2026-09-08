# Evidence: grounding, verification, and honesty

## Source-grounded evidence

Evidence nodes are source-grounded: `ArgNode.citations?: EvidenceCitation[]` (`{ sourceName, homepage?, excerpt? }`). Judging prompts require every `cited`/`strong` evidence node to carry ≥1 citation naming a **real institution or outlet** (root homepage only — never invented article URLs). `validateGraph()` enforces this; the UI renders `⚠ no citation` flags.

## Citation verification

`src/lib/citationVerifier.ts` keeps an offline allowlist of ~25 real institutions (Nature, Reuters, AP, Pew, NREL, Lazard, NIST, OECD, WHO…). `verifyCitation` / `verifyGraphCitations` flag `hallucination` / `unknown_source` / `bad_url` / `missing_homepage`; `sourceQualityScore` tiers sources 1 (peer-reviewed) → 3 (unknown). The offline allowlist is the floor — live homepage reachability is a future server-side check.

## Quote verification

Quoted spans are checked against the cited source's excerpt (`src/lib/quoteVerification.ts`):

- verbatim → verified;
- close but not verbatim → paraphrase;
- partial overlap → misquoted;
- absent from the source → **fabricated**.

`evidenceQualityScore` folds source tier + quote fidelity + date recency into one 0–1 score; `graphEvidenceReport` counts fabricated quotes and docks its score for them.

## Claim-to-source matching

A claim's content is graded against the best-matching cited excerpt: **supported → weak → mismatched**. A claim that only repeats the source's name is weak; a claim whose content appears nowhere in the cited source is a decorative citation and is counted (`claimMismatchCount`) and demoted to tangential. No excerpt attached means **unverifiable**, not a violation.

## Topic evidence cards

Daily topics are grounded with 3–5 real, well-known institutions relevant to the motion (homepage + angle). The model has no live web access: these are named credible sources to research yourself, with verification chips (supports claim / current / primary / relevant) computed where passages are stored.
