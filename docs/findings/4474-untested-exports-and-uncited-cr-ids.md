---
title: 271 of 1,050 exported engine functions and 70 CR ids cited in code appear in no test
discoveredBy: 4474
status: draft
confidence: medium
---

**What is wrong.** By reference (2026-09-24, `staging` bd482d9e2): 271 of the
1,050 exported functions under `convex/gre/*.ts` are named in no test file
(`state.ts` 64 of 207; 44 of the 271 also have no production user outside
their module — dead-export candidates). 764 distinct `CR` ids are cited in
engine code and 70 of them by no test (top by production citations: 108.1,
614.1, 201.4a, 611.3, 103.8a, 504.2, 613.7m).

**Evidence.** Sweep output in the session scratchpad (`suite/cov/`,
`audit-coverage-gaps.md` §9–10).

**Why it may not deserve its own issue.** "Named in a test" is a weak proxy —
a private helper is exercised through its public caller — and PRD #4474 pins
the subjects of the queued refactors, which is the part with a blast radius.
The 44 no-user exports are worth a knip-style dead-export pass (one ticket);
the 70 CR ids are a backlog line for `/gre-test`, not a sprint.
