---
title: '"At the beginning of the cleanup step" PRINTED triggers can never fire — firePhaseBeginTriggers is skipped on AUTO_PHASES'
discoveredBy: 2472
status: draft
confidence: medium
---

**What is wrong.** #2472 landed the CR 514.3a boundary for _delayed_ triggered
abilities (`DelayedTriggerTiming = "next-cleanup-step"`, fired from the CLEANUP
arm of `performPhaseEntry`). The other half of CR 514.3a — a triggered ability
printed on a permanent that says "at the beginning of the cleanup step" — still
cannot fire, because `advancePhase` never scans for beginning-of-step triggers
during CLEANUP at all.

**Evidence.** `convex/gre/phases.ts:144` — `AUTO_PHASES = new Set(["UNTAP",
"CLEANUP"])`. `convex/gre/phases.ts:3295` gates the CR 603.6a scan on it:

```ts
if (!AUTO_PHASES.has(state.phase)) {
    firePhaseBeginTriggers(state);
}
```

The comment right above it says so explicitly ("triggers scoped to those steps
are out of scope for now and would need to be held until the next priority
window"). The new `next-cleanup-step` fire site sits _below_ that gate, inside
`performPhaseEntry`, so it is unaffected — but a `PHASE_BEGIN`-matching
`TriggeredAbility` on a card is not. The same gap exists for UNTAP (CR 502.4 —
"no player receives priority during the untap step", so an untap-step trigger
must likewise be held).

**Why it may not deserve its own issue.** No shipped card needs it. In real
Magic, "at the beginning of the cleanup step" is essentially only ever the
delayed-trigger wording that #2472 just implemented; printed cleanup-step
triggers are vanishingly rare (and the untap-step ones — Erg Raiders' era
wording — are all templated as upkeep triggers in modern Oracle text). The
machinery for it is also non-trivial: unlike the delayed path, a printed trigger
scanned at CLEANUP would need the same 514.3a window plumbing plus a decision
about whether the UNTAP twin holds to upkeep. Probably a line on a
partial-implementation tracker rather than a ticket, unless a card lands that
needs it.
