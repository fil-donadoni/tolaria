---
title: The Bot-play sweep cannot see a choice-surface freeze, because the fallback that answers a generator-less choice lives client-side in brain.ts
discoveredBy: 3830
status: draft
confidence: high
---

**What is wrong.** ADR 0105 § 7.2 defines `frozen` as "no legal move, **or an
expected input the driver cannot answer**". The sweep
(`convex/gre/ai/botReach.ts`) implements the first half and not the second. The
reachability walk's seam 2 (`convex/CLAUDE.md` § Bot reachability) says a
choice with no candidate generator and no fallback freezes the game — but the
FALLBACK is `chooseOwedChoiceAction` / `chooseResolution` in
`src/lib/ai/brain.ts` (ADR 0016 minimal-legal), and an engine-side module may
not import the client. So the sweep can prove a choice is SEARCHABLE
(`isSearchableChoiceNode`) and cannot prove one is unanswerable.

**Evidence.** 14 of the 29 `PendingChoiceKind` members have no entry in
`CHOICE_CANDIDATE_GENERATORS` (`coin`, `die`, `discard-hand`, `divide-piles`,
`keep-hand`, `keep-permanents`, `mulligan-bottom`, `name-card`, `partition`,
`pick-pile`, `pick-source`, `reorder-library`, `reveal-hand`, `untap-pick`) and
are answered every day by the minimal-legal fallback. A first cut of this sweep
read "no decider + no candidates" as a freeze and quarantined 13 correct cards
(Reclamation Sage, Conclave Naturalists, …) whose post-cast state is an
executor-driven `pendingCast` window with two live `may-pay` candidates.

**Why it may not deserve its own issue.** The half that is built is the half
that withholds cards, and the other half may belong with the sweep's move to a
place that can see both sides (a `scripts/`-hosted driver harness, or the
`decideBotAction` seam extracted to a pure module) — which is a design question
for the Bot roadmap rather than a defect. Until then the sweep measures seam 1
and seam 3, and seam 2 stays a human walk.
