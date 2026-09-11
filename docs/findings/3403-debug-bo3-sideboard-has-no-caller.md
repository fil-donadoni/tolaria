---
title: debugBo3Sideboard is a public mutation with no caller left anywhere
discoveredBy: 3403
status: draft
confidence: medium
---

**What is wrong.** `api.game.debugBo3Sideboard` is a public Convex mutation that
now has zero callers. Its only one was the "Bo3 Sideboarding" button in the debug
panel, which issue #3403 removed along with six other buttons. It promotes the
current solo Match to Bo3, records a Game-1 result and routes to the Sideboarding
step — a real state transition, reachable by anyone who can address the endpoint,
and no longer reachable through any surface in the product.

**Evidence.** `convex/game.ts` defines it; `grep -rn "debugBo3Sideboard" src/`
returns nothing after PR for issue #3403. `convex/__tests__/matchLifecycle.test.ts`
is the only remaining reference.

**Why it may not deserve its own issue.** The between-Games flow it exercises is
still worth being able to reach from a test or a script, so deleting it outright
may be wrong — the honest choices are (a) delete it and let
`matchLifecycle.test.ts` drive the underlying helpers directly, or (b) keep it and
give it the `assertIsTester` gate the rest of the tester surface now carries. That
is a one-line decision a human makes faster than a ticket describes, and issue
#3403's scope was explicitly the UI removal only.
