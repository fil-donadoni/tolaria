---
title: check:ui is red on the main tip — three surfaces over budget with nobody owning them
discoveredBy: 2722
status: draft
confidence: high
---

**What is wrong.** `bun run check:ui` fails on the **unmodified** default branch.
Every UI slice of PRD #2721 will therefore open with a red lane it did not
cause, and the standing instruction ("a surface the lane could not reach is a
red, not a pass") gives an implementer no way to tell an inherited red from
their own. The three failures are stale ceilings, not new defects — but nothing
distinguishes those two things at the point where it matters.

**Evidence.** Measured on a detached worktree at `55d32f07` (the branch base for
#2722), `bun run check:ui`, 2026-08-25:

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

All ten reproduce byte-identically on the #2722 branch, which touches none of
those surfaces' components. `limited-list` and `design-system-dialog` ALSO went
`could not be reached — walk threw: goto: Timeout 20000ms exceeded` on the first
full base run and walked fine when re-run alone, so the lane has a flaky-walk
problem on top of the stale ceilings — a timeout reads as a coverage red and is
indistinguishable from a genuinely unreachable surface.

`draft-pool-stop @ 390x844x3: small 9 > 6` is the loudest: `budgets.json`'s own
note for that cell says `small6` was "tightened from 9", i.e. the ceiling was
lowered to a value the surface does not currently meet.

**Why it may not deserve its own issue.** #2659 already owns lowering `small`
across touch surfaces, and #2665 owns the landscape-phone tile rung, so most of
these rows may be re-recordings those issues will do anyway. What is NOT covered
by either is the meta-problem — the green-main invariant is enforced for
`check:all`/`test` by `scripts/gate.ts` but not for `check:ui`, so this lane can
sit red indefinitely without anything noticing. That half is arguably one line
on #2580 (the lane's own issue) rather than a ticket.
