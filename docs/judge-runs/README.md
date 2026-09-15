# Judge experiment runs

Raw, complete artifacts of controlled benchmark studies. **Every raw run is
preserved** - nothing here is cherry-picked or averaged away. Gate decisions
are per-run; summary tables are descriptive dispersion only.

## Study 2026-09-15: does the v5 citation clause cause the fake-citation regression?

- Arm `v5base-2026-09-14/`: 2 clean full-pack runs of the shipped v5 prompt (kiraai).
- Arm `v51czw-clean-2026-09-15/`: 2 full-pack runs of the single-variable
  candidate (`citation-zero-weight`: default-zero evidential weight + no
  confidence lift; every other clause byte-identical).
- Arm `v51czw-2026-09-15-contaminated-double-load/`: three runs executed under
  a self-inflicted double-load incident (two candidate processes raced each
  other and the baseline tail; kiraai degraded to 0-43% reliability). Kept as
  evidence and **excluded from the verdict**; the incident is why provider
  load must be serialized between arms.

Verdict (`scripts/judge-experiment-report.mjs`, target = fake-citation
influence): **REJECT the candidate.** Mean fake-citation went 0.233 -> 0.256
(inside run noise) - H1 falsified. All arms, including v4-era numbers, sit in
0.14-0.38 with ~0.05-0.10 run-to-run sd: the v4->v5 "regression" reading was
tail noise on a metric this free model fails regardless of wording. Shipped
default stays v5. Follow-ups must interleave arms (A,B,A,B) and target
agreement/ECE, where the gates are not yet noise-bounded.

Thresholds in `config/judge-gates.json` were not modified by this study.
