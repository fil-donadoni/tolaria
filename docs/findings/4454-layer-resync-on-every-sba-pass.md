---
title: recomputeContinuousEffects re-derives layers 2–6 on every SBA pass (4.3 % of search) — a dirty flag is an engine-authority change
discoveredBy: 4454
status: draft
confidence: medium
---

**What is wrong.** Every state-based-action pass re-derives layers 2–5 and 6
whether or not anything layer-relevant changed; with the off-battlefield
characteristics refresh it is ~6.5 % of search time.

**Evidence.** `convex/gre/state.ts` `recomputeContinuousEffects` (~9987) and
its SBA call; 2026-09-23 profile.

**Why it may not deserve its own issue.** It is the server's path too (ADR
0074): a staleness bug here is a rules bug, and PRD #2064's history removed
exactly this kind of staleness once. Skip it until the Continuous Effects
Registry (ADR 0082) lands, which is where a change-tracked derivation belongs;
a dirty flag bolted on now would be undone by it.
