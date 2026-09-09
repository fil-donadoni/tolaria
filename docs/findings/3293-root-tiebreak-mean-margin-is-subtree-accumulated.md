---
title: selectRootMove's material tie-break reads a subtree mean, so `pass` carries the blunder it was meant to avoid
discoveredBy: 3293
status: draft
confidence: high
---

**What is wrong.** When the search rates two root moves indistinguishable,
`selectRootMove` breaks the tie on `meanMargin` — accumulated over the whole
SUBTREE of each edge. The `pass` subtree explores taking the same action one ply
later, so it carries the identical loss, while the action's own subtree has
already paid it and recovers from there. The action therefore WINS a tie-break
whose whole purpose was to reject it, and more search makes it worse rather than
better, because the artifact is in what the mean is taken over, not in how many
samples it has.

**The REFUSAL half is closed; this is now about the other half.** Issue #3293
landed the leaf-decisive answer for a cast that should not happen: issue #3194's
self-confined hold already reads a settled 1-ply outcome rather than that mean,
and it was inert here only because its confinement probe counted the per-turn
tallies a self-inflicted death writes (`deathsThisTurn`, `lastKnownCopiable`) as
evidence the announcement had reached the opponent. With the echoes dropped, the
blade negative control goes 0/5 → 5/5 at the production budget and is `must`.

What no hold rule can do is make the bot WANT a line: the paired PAYOFF entry
("cheat into play: casts for a body that pays on the way out") still needs 1200
iterations, because at 400 the cast and `pass` tie inside `outcomeEps` and the
tie-break reads that subtree mean. So the artifact stands, in the direction where
the right move is the ACTION.

**Evidence.** `convex/gre/search.ts`, `selectRootMove`. Measured on issue
#3293's pair: the payoff half is priced correctly at the 1-ply probe (cast 756.4
against 509.8 for passing, because the body leaves a token copy of itself behind
when the sacrifice takes it) and still loses the root on 5/5 seeds at 400, then
wins on 5/5 at 1200 — byte-identically before and after the confinement fix.

**What was already tried and rejected**, both measured in-session:

- a plain "settled value below passing" floor reds **twelve** `must` entries
  (Dark Ritual, morph, fetchland, Grapeshot, a cantrip dig, Liliana's −2, …) —
  spending now to be paid later is most of Magic, and every one of those is
  behind on some axis at 1 ply;
- an AXIS-WISE dominance floor (no term better, at least one worse, compared
  only on fully-settled outcomes) gets that to **one** red, and the one it keeps
  is `choice-behind payoff: the re-type mode stays live against the opponent's
lands` — whose own note records that `evaluate`'s mana term is colour-blind by
  construction, so a rule of this shape cannot tell "there is no effect" from
  "the evaluator cannot see the effect". (The hold that shipped instead answers
  this by asking the STRUCTURAL question — did the resolution reach the
  opponent's record at all — which Vision Charm's re-typed Forests answer yes to
  even though every term reads flat.)

**Why it may not deserve its own issue.** The cheap fixes are refuted above, and
what is left is a want-side rule rather than a refusal: either a leaf-decisive
root quantity for the ACTION (the settled per-candidate value `buildTrace`
already computes) or a colour-aware mana axis that would make the Vision Charm
case measurable and let the dominance floor stand. Either would let the payoff
half of the pair be promoted to `must`. Worth pairing with
[[3292-latent-noncreature-floor-hides-a-negative-script]], which is the same
position seen from the value model's side.
