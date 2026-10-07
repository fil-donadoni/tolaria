# A Symmetric Effect is read by Differential on the real board, and the Latent Floor holds only for a script that is both unmeasured and incomplete

## Status

accepted — grilled 2026-10-07 (static-evaluation blind-spot survey session).
Amends ADR 0124 (latent script value = weight × realised loss of the best
target on THIS board) by extending the lens principle to the two-victim case,
and narrows the `base + MV` uplift introduced for issue #1430.

## Context

The survey that followed issue #4141 (aiEffects backfill, premodern upkeep
taxes and locks) found that none of the slice's eight shadows could move a
decision: every one read BELOW its `base + MV` fallback, and the fallback is an
uplift-only rule. A census over the catalogue (2026-10-07) made the shape
visible — 216 non-creature permanents whose only readable script is a standing
ability, 166 of them inert under the floor, 52 reading negative. Two separate
rules produced the number:

- **Symmetric effects are priced at zero or at the caster's cost.** A `$each`
  player reference scores 0 points by design (issue #1521): the walker values
  a `forEach { set: "players" }` body once, for a representative member, and
  cannot tell which player a Balance or a Wheel hurts more. A standing
  symmetric static (Stasis, Winter Orb, Howling Mine) is read context-free by
  the standing reader of issue #5145 and comes out as a cost to its controller
  — the one player the reader can see.
- **The Latent Floor is an uplift.** `latentValue` never lets a non-creature
  card drop below `base + MV`, so a script the Op vocabulary undervalues
  (issue #1430's backfilled Ops) cannot sink the card. The same rule, applied
  to a complete and honest script, hides a genuine tax: Elephant Grass is
  priced as any one-mana enchantment, and a lock the Bot should remove is a
  generic artifact of its mana value.

Both rules were right for the state of the vocabulary they were written
against. The lens of issue #3398 (ADR 0124) already measures a targeted Op on
the real board and, when it answered, already removes the floor
(`dslSpellValueMeasured` → fallback 0): a removal spell facing an empty board
is worth nothing. The `aggregateLoss` of issue #4874 prices a sweep over every
permanent of one side. The machinery to read a symmetric effect as the
difference between two sides therefore exists; what was missing was the rule
that it applies.

The alternative — a per-card sign (`aiValue`, or a shadow written from one
player's point of view) — is card-shaped (ADR 0102) and wrong in half the
games the card is played: Winter Orb is a weapon with two lands against six and
a liability the other way round.

## Decision

1. **A Symmetric Effect is read by Differential Reading.** On a real board,
   the value of an effect that acts on every player alike — a one-shot
   `$each` script or a standing symmetric static — is the opponent's realised
   loss minus the caster's, each side measured by the lens ADR 0124 already
   prescribes for a targeted or sweep Op. Context-free (a draft pick, no
   board) the reading is zero; a Symmetric Effect never carries a fixed sign,
   on the card or in a shadow.
2. **The Latent Floor holds only for a script that is both UNMEASURED and
   INCOMPLETE.** A script the lens measured reads its own number (already the
   rule for spells, `dslSpellValueMeasured`, now also for a permanent's
   standing reading). A Complete Script read context-free also reads its own
   number, negative included: a self-tax is worth less than a blank card of
   its mana value, in a draft pick as on the board.
3. **A Complete Script is decided by the existing Op census, fail-closed.**
   Every Op of the script resolves to a valuer whose beneficence is declared
   (not `neutral`, the issue #3006 census) and the script names no `$each`
   reference. One neutral Op or one symmetric reference and the script is
   incomplete, the floor stands. No per-Op `complete` flag: a second source of
   truth no guard keeps aligned.
4. **Both faces stay one number.** A standing symmetric static is re-read at
   every leaf against the live board, exactly as `nonCreatureBodyValue`
   already re-reads a permanent, so casting a lock is never a value loss this
   rule causes (the one-number rule of issue #5145). The asymmetric
   restricted-side reading of issue #5154 is the per-side measurement the
   differential nets.

## Consequences

- Issue #5151 (recurrence multiplier) prices a recurring trigger inside the
  standing reading; this ADR decides what the floor does with the result. The
  two compose: a recurring self-tax on a Complete Script reads negative and
  stays negative.
- Issue #5150's inert census shrinks as scripts complete or are measured; a
  row that stays inert names an Op still `neutral` — the census is the queue
  for that Op's beneficence.
- The 48 `neutral` beneficence rows become the boundary of trusted
  valuation: declaring one is now a valuation change with a refit, not a
  bookkeeping edit.
- The Bot Drafter (context-free) sees negative worth for a complete self-tax;
  its pick ratings are refit after the first slice lands (`blade moves entry
→ refit`).
- Out of scope here: cost modifiers as a mana-economy term, replacement
  effects, non-linear life (tracker issue #5156).
