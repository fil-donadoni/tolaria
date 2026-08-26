---
title: A death-trigger payoff can make the pruned self-sacrifice line correct again
discoveredBy: 2297
status: draft
confidence: low
---

**What is wrong.** #2297's prune drops the whole `activate-ability` move when
the ability's own source is the only legal victim of its sacrifice cost and the
ability's effect is confined to `$source`. The dominance argument for that is
airtight while ANOTHER victim exists (same cost class, strictly better payoff —
the other variants are still searched). It is one step weaker in the
only-victim case: the argument there is "the resolution is empty, so the
activation is dominated by passing", which ignores value that comes from the
SACRIFICE rather than from the resolution — a `CREATURE_DIED` trigger the
controller owns (a Blood Artist / Zulaport-style drain), or sacrificing in
response to a gain-control or exile effect. With such a trigger on the
battlefield, sacrificing a self-pumping outlet to its own ability really is a
line the bot can no longer see.

**Evidence.** `convex/gre/activationCostPicks.ts` —
`sacrificeMustSpareSource` / `enumerateActivationCostPicks` filter on the
ABILITY's Op vocabulary alone; nothing in that path inspects the board for a
death trigger, and `abilityBenefitIsConfinedToSource`
(`convex/gre/ai/sourceConfinedBenefit.ts`) is deliberately a pure function of
the ability, with no `GameState` parameter. The blade entry "sac outlet: does
not activate at all when it is its own only victim"
(`convex/gre/ai/blade/registry.ts`) encodes the current, stricter answer.

**Why it may not deserve its own issue.** Three reasons to leave it. (1) #2297
asks for exactly this behaviour and names "Broader Bot evaluation tuning for
sac outlets beyond the dominated self-sacrifice case" as out of scope. (2) The
catalogue population is currently empty in practice: the only two cards the
prune reaches are Fallen Angel (`convex/cards/sets/leg/black.ts`) and
Devouring Strossus (`convex/cards/sets/inv/black.ts`), and a shipped
controller-side `CREATURE_DIED` drain would have to be on the battlefield
alongside one of them. (3) The fix is not cheap — the predicate would have to
become board-aware, which is a different seam from the static script analysis
it is today. If a drain outlet ever ships, the cheap correction is to gate the
`victims.length === 0 ⇒ no move` half (not the "prefer another victim" half) on
"the controller has no death trigger", which keeps the reported bug fixed.
