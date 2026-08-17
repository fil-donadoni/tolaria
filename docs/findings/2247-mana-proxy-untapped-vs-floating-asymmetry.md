---
title: The Brain's coarse mana proxy still counts an untapped multi-mana source as 1, everywhere except auto-tap ranking
discoveredBy: 2247
status: draft
confidence: medium
---

**What is wrong.** `availableManaFor` (`convex/gre/evaluate.ts:227-241`, and
its documented duplicate `convex/gre/heldInteraction.ts:48-63`) counts an
UNTAPPED mana source as exactly 1 unit regardless of its real output, while
floating mana in the pool counts per unit. Issue #2247 fixed the one place
this inversion produced an observably wrong RANKING decision (smart auto-tap
preferring to tap a multi-mana rock over an exact-fit land) by adding a
dedicated surplus-avoidance term to `solveSmartAutoTapCore`
(`convex/gre/autoTap.ts`) that reads `floatingAfterPlan`'s exact leftover pool
directly — it does not read the coarse proxy at all, so it is correct
independent of the proxy.

The proxy itself is untouched and still feeds, bot-wide:

- `evaluate()`'s `mana` term (`terms.mana = availableManaFor(player) * W_MANA`,
  `evaluate.ts:510-511`) — a leaf value on essentially every ISMCTS node.
- `hasCastableInstant` (`evaluate.ts:248-260`) and `flexibilityTerm`
  (`evaluate.ts:452-471`) — the castability gates for reactive-flexibility.
- `hasCastableInstantHint` / `castableHeldInteraction`
  (`heldInteraction.ts:77-111`) — the combat-side held-interaction predictor.

Any board with an untapped multi-mana producer (Sol Ring, Mana Vault, Gaea's
Cradle, Cabal Coffers, Nykthos, a board-derived rock) still under-counts its
own available mana in these leaves, and — once the source is TAPPED — the
resulting floating mana is counted at full value. That is the same
under/over-counting shape #2247's bug report described, just not expressed as
a ranking inversion in these call sites (there is no second candidate plan to
invert against — `evaluate()` is a single-position scalar, not a ranking).

**Evidence.**

- `convex/gre/evaluate.ts:227-241` (`availableManaFor`) — line 235,
  `if (isUntappedManaSource(...)) n += 1;` vs line 238,
  `n += player.manaPool[c] ?? 0;`.
- `convex/gre/heldInteraction.ts:48-63` — the same shape, `mana += 1` vs
  `mana += player.manaPool[c] ?? 0`.
- Both now carry an explicit divergence note (added in #2247) pointing back
  here as "out of scope for #2247."

**Why it may not deserve its own issue yet.** Correcting the proxy to count a
source's real output is BOT-WIDE: it moves `evaluate()`'s leaf value on every
node with a multi-mana untapped source in play, the castability gates, and the
reactive-flexibility term simultaneously, across two files with a documented
"mirror" relationship that must move together. That is a real re-tuning /
re-validation effort (full blade suite + a strength-claim self-play ladder
pass, per the bot-slice doctrine — a leaf-value shift is exactly the kind of
change that doctrine reserves the ladder for), not a small fix, and #2247 did
not surface a concrete SYMPTOM of it beyond the ranking bug already fixed
locally. Worth a ticket once/if a real game shows the bot mis-valuing a
position because of it (e.g. undervaluing a Sol Ring board's threat of
reactive plays) — until then this is a documented, bounded simplification, not
a live bug.
