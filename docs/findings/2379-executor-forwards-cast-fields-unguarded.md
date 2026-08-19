---
title: Two of the three cast fields the Bot executor forwards have no guarding test
discoveredBy: 2379
status: draft
confidence: high
---

**What is wrong.**

`src/lib/ai/executor.ts` forwards three fields into `announceCast`:
`chosenX` (`:329`), `alternativeCostId` (`:335`) and `additionalCostLegId`.
Deleting **either of the first two** leaves the entire bot suite green — 45
files / 365 tests — while breaking the Bot for every card that needs them.

That is the #2283/#2284 shape: a Move the Bot enumerates but cannot announce,
which surfaces as a frozen game rather than a failing test.

**Evidence.**

Measured by mutation on the merged tree. `additionalCostLegId` **is** guarded —
deleting it reds `src/lib/ai/__tests__/executor.bot.test.ts` — so the asymmetry
is visible in one file: the newest field carries a guard its two neighbours do
not.

Provenance: `alternativeCostId` arrived with #2576 (Bestow) and `chosenX` with
#110; neither was introduced by #2379, which is only where the gap became
measurable, because its own test sits next to them.

**Why it may not deserve its own issue.**

The fix is small enough to ride along with the next change that touches this
file: one `expect(m.announceCast.mock.calls[0][0].alternativeCostId)`
assertion beside the existing `additionalCostLegId` one, and the same for
`chosenX`. Against that, "the executor drops a cast field" is exactly the class
of bug the project already has two issues about (#2283/#2284), and those were
expensive to diagnose from the symptom — which argues for closing it
deliberately rather than opportunistically.
