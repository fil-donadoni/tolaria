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

**Evidence.** `convex/gre/search.ts`, `selectRootMove`. Measured on issue
#3293's position (Flash plus a vanilla body it cannot pay for, exactly two
lands): the 1-ply probe is correct after this slice — cast settles to an empty
board, passing keeps two cards and the mana — yet the root chooses the cast on
5/5 seeds at 400, 1200 and 4000 iterations. The blade entry
"cheat into play NEGATIVE CONTROL" carries the numbers.

**What was already tried and rejected**, both measured in-session:

- a plain "settled value below passing" floor reds **twelve** `must` entries
  (Dark Ritual, morph, fetchland, Grapeshot, a cantrip dig, Liliana's −2, …) —
  spending now to be paid later is most of Magic, and every one of those is
  behind on some axis at 1 ply;
- an AXIS-WISE dominance floor (no term better, at least one worse, compared
  only on fully-settled outcomes) gets that to **one** red, and the one it keeps
  is `choice-behind payoff: the re-type mode stays live against the opponent's
lands` — whose own note records that `evaluate`'s mana term is colour-blind by
  construction. Vision Charm denying an opponent's green and Flash cheating a
  vanilla body in both measure as hand, mana and flexibility down with nothing
  up, so a rule of this shape cannot tell "there is no effect" from "the
  evaluator cannot see the effect". Gating it on
  `reachesOnlyOwnSideThroughChoice` (issue #3194's own predicate) does not
  separate them either: that predicate requires FUTILITY and answers false for
  Flash, whose resolution does change the board on the way through.

**Why it may not deserve its own issue.** The fix is not obvious and the two
cheap ones are refuted above; what it probably needs is either a leaf-decisive
root quantity (the settled per-candidate value `buildTrace` already computes) or
a colour-aware mana axis that would make the Vision Charm case measurable and
let the dominance floor stand. Either is a slice of its own, and either would
close issue #3293's blade pair. Worth pairing with
[[3292-latent-noncreature-floor-hides-a-negative-script]], which is the same
position seen from the value model's side.
