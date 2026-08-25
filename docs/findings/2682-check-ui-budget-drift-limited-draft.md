---
title: check:ui fails on main today — limited-list/limited-your-events/draft-pool-stop over budget
discoveredBy: 2682
status: draft
confidence: low
---

**What is wrong.** `bun run check:ui`, run clean against this branch (which
touches none of the affected surfaces), exits 1 on 10 rows across 3 surfaces —
all "small" (sub-44px control) or "occ"/"starved" counts sitting 1-3 units
above their recorded budget ceiling:

```
· limited-list @ 1440x900x2: small 25 > 24
· limited-list @ 390x844x3: starved 1 > 0, small 17 > 16
· limited-list @ 820x1180x2: small 22 > 21
· limited-list @ 1180x820x2: starved 1 > 0
· limited-your-events @ 1440x900x2: small 23 > 22
· limited-your-events @ 390x844x3: small 16 > 15
· limited-your-events @ 820x1180x2: small 21 > 20
· limited-your-events @ 1180x820x2: small 21 > 20
· draft-pool-stop @ 390x844x3: small 9 > 6
· draft-pool-stop @ 844x390x3: cardsOcc 3 > 2, ctrlsOcc 3 > 2
```

**Evidence.** Full run log:
`/tmp/checkui-2682.log` (this session only — not preserved). `scripts/ui-gate/budgets.json`
carries the recorded ceilings; none of `limited-list`/`limited-your-events`/
`draft-pool-stop`'s source (under `src/routes/limited/`, `src/components/draft/`)
is in this PR's diff (`git diff --stat main...feat/issue-2682` — 13 files, all
`convex/gre/**`, `src/components/debug/ai-decision-trace.tsx`,
`src/hooks/useVsAiDriver.ts`, `src/lib/ai/brain-client.ts`, and their tests).

**Why it may not deserve its own issue.** Two live possibilities I did not
distinguish: (1) genuine new debt — the sub-44px/occlusion counts really did
creep past the recorded ceiling since these rows were last measured (several
of the lane's own embedded per-row notes reference `small` deltas of exactly
+1 from font/token changes in unrelated PRs, e.g. the identity-v4 slice's
`design-system` +1 note in the same log — the same class of drift could have
hit these 3 rows too, unrecorded); (2) measurement jitter — several deltas are
exactly 1 unit, consistent with a sub-pixel rendering/font-metric difference
across runs rather than a layout regression, and this session's machine was
under extreme concurrent load (load average 20/61/101) which the lane's own
budgets were not calibrated against. I did not re-run on a quiet machine or
diff against a last-known-good screenshot to tell which. If it is (1), this is
a line for whichever issue already owns `limited-list`/`draft-pool-stop`'s
`small`-control debt (the log's own notes reference #2658/#2659/#2665 as the
active owners of this exact debt class on sibling surfaces) rather than a new
ticket.
