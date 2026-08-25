---
title: Dash discriminating-pair blade entries don't independently flip under the sign bug they're paired with
discoveredBy: 1964
status: draft
confidence: medium
---

**What is wrong (or rather: what does NOT prove what it looks like it proves).**
Issue #1964 asked for a `must`-tier blade discriminating pair — a Dash creature
castable both ways, one board where dashing is right, one where hard-casting is
right — explicitly so "the entry would fail under the old +55 pricing." I built
both halves (`convex/gre/ai/blade/registry.ts`, labels "discriminating pair:
dashes Ragavan for the lethal attack" / "…hard-casts Ragavan on an empty board
with nothing to race") and verified them via a manual proof-of-failure: reverting
ONLY the sign fix (`opValuers.ts`'s `HAND_RETURN_SELF_COST` branch) while leaving
everything else — the dash cast-move enumeration, `dashTrigger`'s decidable
gate — intact.

**Result: neither half flips.** Both still choose the correct move (dash /
hard-cast respectively) even with the self-bounce mis-priced back to the old
+55 "tempo" bonus.

**Why, as best I can tell.**

- The lethal half's leaf state lands in `evaluate.ts`'s win/loss BAND (CLAUDE.md:
  "banded so a win dominates material") — once the position is a win either way
  the game ends, the ±110-point swing between the old (+95) and new (-15)
  ability-script contribution never gets a chance to matter; the decision is
  driven by whether the extra 2 damage crosses lethal, a fact this specific sign
  bug is orthogonal to.
- The empty-board half stayed correct too, which is harder to explain — at its
  declared budget (400 iterations) whatever term is deciding "don't bother
  dashing here" isn't dominated by `dslRealizedAbilityValueById`'s ability-script
  term either. I did not chase this further (time-boxed per the convergence-cap
  rule); a plausible read is that the STATIC term computed by
  `dslRealizedAbilityValueById`/`evaluateCreature` (`convex/gre/evaluate.ts:178`)
  matters more as a PRIOR/heuristic at tree-expansion time than as the terminal
  leaf score by the time a rollout reaches a point where the delayed return has
  already fired (Ragavan is back in hand by then, so the term it would have
  contributed has already left the board state being scored) — but I did not
  instrument the search to confirm this, so treat it as a hypothesis, not a
  finding.

**Evidence.** `convex/gre/ai/blade/registry.ts` — both entries' own comments
document the measured (not merely asserted) insensitivity, including the exact
iteration sweep (2000→PLAIN, 3000/4000/5000/6000→dash, 8000→PLAIN again, for the
lethal half — a wide but non-monotone plateau, itself worth a second look).

**Why it may not deserve its own issue yet.** The blade entries are still
genuinely useful — they prove the Bot, once it can enumerate a Dash cast at all
(the `moves.ts`/`applyMove.ts` fix in the same PR), makes the RIGHT choice in
two real positions. The sign regression itself IS pinned, just at the unit
level (`opValuers.bot.test.ts`, `cardScriptValue.bot.test.ts`,
`triggerGate.bot.test.ts`), each proven via its own proof-of-failure. This is a
"the blade suite doesn't reach every fix" observation, not a broken guard — but
if a FUTURE regression in this exact valuer ever needs a blade-level (not just
unit-level) trip-wire, someone will need to either find a position where the
static ability-script term is NOT washed out by combat/lethal framing, or
accept that this class of fix is fundamentally a unit-tested one. Also worth
a look: the non-monotone 8000-iteration flip on the lethal entry — every other
budget-swept entry in this registry (Dreadnought, Kavu) is monotone once it
starts passing; this one isn't, and I didn't have budget left to chase why.
