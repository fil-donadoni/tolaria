# ADR 0020 — Bot timing & option-value awareness

**Status:** Proposed (2026-06-16)

**Refines:** [ADR 0001](0001-ai-opponent-client-side-ismcts.md) (the client-side
ISMCTS opponent), [ADR 0015](0015-rollout-terminates-at-turn-boundary.md) (the
turn-boundary rollout horizon), and [ADR 0018](0018-forge-style-evaluation-enrichment.md)
(the Forge-scale leaf evaluation). It addresses a class of misplay those ADRs
left open: the bot picks the right _outcome_ but the wrong _timing_, and spends
resources that are worth more held.

## Context

Three live DecisionTraces from solo games surface the same family of error. In
each, the bot's choice is legal and not catastrophic, but a competent player
would never make it.

1. **Sits on a land drop.** With a Forest in hand and nothing else to do, the bot
   scores `pass` and `play Forest` as outcome-equal (meanReward 0.66352 vs
   0.66331, within `OUTCOME_EPS`). The issue-#138 material tie-break then picks
   `pass` on a 329.3-vs-327.5 `meanMargin` margin — pure rollout noise — and the
   land is played in the second main instead. The immediate leaf eval actually
   prefers the land (336 vs 327); the rollout washes the tempo out because within
   the turn the land is down either way before the horizon.

2. **Dumps a combat trick at sorcery speed.** Holding only Giant Growth, the bot
   casts it on its own creature in precombat main (meanReward 0.404 > `pass`
   0.377 — a genuine search preference, not a tie). Two causes compound: the
   `evaluate` leaf counts the "until end of turn" +3/+3 as permanent material
   (creatures term +87 = exactly `3×W_POWER + 3×W_TOUGHNESS`), and the weak
   rollout cannot hold the instant for the right moment, so holding always looks
   worse than spending now.

3. **Attacks with a mana dork into death.** With an empty hand, the bot attacks
   with Birds of Paradise (a 0/1 mana source) alongside its real threats. The
   leaf eval already penalizes it — `self.mana` drops 72→60 when BoP attacks and
   stops being a mana source — yet the bot attacks anyway. Decisively, the leaf
   `evaluate` is **identical (−429.5) for every attack set**, because a
   `declare-attackers` leaf is scored _before_ damage: the eval is blind at the
   exact decision combat hinges on, so the choice is left entirely to the noisy,
   aggressive rollout.

The unifying diagnosis is that the search is blind to **timing and option
value**, and this blindness lives in two places:

- **The leaf `evaluate` has option-value blind spots.** It counts a temporary
  buff as permanent material (case 2); it cannot see the worth of a card or
  creature _kept in hand / kept back_ — an instant held for the right window
  (case 2), a blocker or mana source held for next turn (cases 1, 3); and it does
  not simulate combat, so a `declare-attackers` leaf carries no information
  (case 3).
- **The rollout policy (`bestImmediateMove`, greedy 1-ply + `ROLLOUT_EPSILON`
  0.25) is aggressive and short-sighted.** It never holds a resource for a later
  turn or a later priority window, so any line that spends now dominates any line
  that waits. This is the same weak-default-policy failure mode ISMCTS is known
  for, here amplified by the eval blind spots above.

The symptoms look opposite — "do too little" (sit on a land) versus "do too much"
(dump a trick, suicide-attack a dork) — but they are one gap: the search does not
value _when_ an action is taken or the worth of the unused option. A single
"prefer acting / prefer passing" bias would fix one case and worsen another;
the fix must be per-move-kind and must distinguish actions with no option cost
(land drops) from actions that destroy an option (instants, attacks with
held-back value).

## Decision

Treat timing & option value as a first-class concern of the bot search, fixed in
**layered, independently shippable** slices, ordered most-deterministic-first.
Prefer selection- and eval-level fixes (pure, testable, bisectable) over rollout
heuristics (powerful but noisy and hard to tune).

1. **Land-drop tie-break (selection layer).** In `selectRootMove`, when the
   robust pick would be `pass` but an outcome-equal `play-land` move exists in the
   contender set, develop the land. A land has no option cost in this engine —
   there is no bluff or hidden-information value to holding it — so deferring it
   is never right, and the deferral here is pure rollout noise. This generalizes
   the issue-#149 "land drop strictly positive" invariant to the tie-break, and
   fires only when `pass` and a land are already outcome-equal, so it can never
   override a real decision.

2. **Temporary effects are not permanent material (eval layer).** A buff that
   lasts "until end of turn" must not be counted by `evaluate` as if it were
   permanent. The leaf either discounts until-end-of-turn P/T modifications or
   excludes them from the latent/realized material term, so casting a combat
   trick in precombat main no longer reads as a free, lasting board gain. This
   removes the false incentive in case 2; it does not by itself teach the bot to
   hold the trick (see lever 4).

3. **Combat-aware `declare-attackers` leaf (eval layer).** A `declare-attackers`
   position is evaluated against the _expected combat exchange_ (a crude
   best-block assignment, reusing the pure predictor that already backs the
   Danger Clock from ADR 0018) rather than the pre-damage snapshot. The leaf then
   distinguishes a profitable attack from a creature walking into death, instead
   of returning the same value for every attack set and deferring to the rollout.
   This directly addresses case 3 and sharpens every combat decision.

4. **Rollout guardrails (policy layer).** The rollout default policy gains a small
   set of negative guardrails so it stops modelling obviously-bad lines as
   typical play: do not attack with a creature worth more held back (a mana
   producer, or an attacker that only chumps into a loss), and do not cast a
   pure instant-speed effect at sorcery speed when it can be held. These are
   pruning/biasing heuristics on the _default policy only_ — never hard legality
   limits — so the search can still explore the move if the tree warrants it.
   Highest-risk lever; calibrated last, behind the eval fixes that reduce how much
   the result leans on the rollout in the first place.

The PRD that follows scopes each slice into issues, with the regression episode
each must add.

## Consequences

- **+** Fixes a visible, credibility-damaging class of misplay (sitting on lands,
  dumping tricks, suicide-attacking utility creatures) without a search-algorithm
  rewrite.
- **+** Slices are independent and ordered by risk: lever 1 is a pure, safe
  tie-break shippable on its own; the eval levers are bisectable; the rollout
  lever ships last when the eval already carries more of the signal.
- **+** Reuses existing machinery — the issue-#138 selection structure, the
  ADR 0018 Danger Clock block predictor — rather than adding new subsystems.
- **−** Levers 2–3 touch the ADR 0018 Forge-scale `evaluate`; magnitudes shift,
  so the `search.ts` reward band and the issue-#138 tie-break threshold may need
  re-checking, and the existing `ai-diagnosis` combat/lethal episodes are the
  gate.
- **−** A combat-aware leaf adds a mini block simulation to `evaluate` on
  `declare-attackers` nodes — more cost per such leaf (bounded; the predictor is
  already pure and used by the Danger Clock).
- **−** The rollout guardrails (lever 4) add tuned conditions to the default
  policy; over-pruning would bias the search. Mitigated by keeping them soft
  (policy bias, not legality) and shipping them last.

## Alternatives rejected

- **One global "act vs pass" bias.** A single knob nudging the bot to act (or to
  wait) more. Rejected: the three cases pull in opposite directions; only a
  per-move-kind treatment that separates no-option-cost actions (lands) from
  option-destroying ones (instants, attacks) can fix all three.
- **Model instant-speed option value explicitly in the eval** (a term for "value
  of cards I can still cast at instant speed"). Most principled, but a large new
  eval concept with its own tuning surface and double-count risk against the
  ADR 0018 latent card value. Deferred; levers 2–4 capture most of the benefit at
  far lower risk.
- **Improve only the rollout policy.** A stronger default policy would, in
  principle, surface all three errors. Rejected as the _primary_ fix: rollout
  heuristics are the noisiest, hardest-to-test lever, and leaning on them is what
  produced these misplays. Pursued only as lever 4, after the deterministic
  selection/eval fixes.
- **Disallow casting instants / attacking with mana dorks outright** (hard
  legality prune at move generation). Cheap but wrong: there are real lines where
  the bot _should_ cast the trick early (mana dump, must-act) or attack with a
  dork (lethal, opponent tapped out). Kept as a soft rollout bias instead.
- **Do nothing — let higher search budgets resolve it.** The traces are at
  90–290 iterations; more iterations sharpen the noisy tie-break (case 1) but do
  not fix a blind leaf (case 3) or a false eval incentive (case 2). Rejected.
