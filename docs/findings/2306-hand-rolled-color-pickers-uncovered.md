---
title: Four hand-rolled colour pickers never carry EffectMode.color, so they stay outside colorModePrior's coverage
discoveredBy: 2306
status: declined
confidence: high
---

**Correction (round 2 review).** This finding's premise is wrong. All four
cards it names DO carry the colour tag:

- Kavu Chameleon (`convex/cards/sets/inv/green.ts:101`), Alloy Golem
  (`convex/cards/sets/inv/colorless.ts:161`) and Shyft
  (`convex/cards/sets/ice/blue.ts:1929`) build their modes with
  `colorChoiceModes` (`convex/cards/abilities/chooseColor.ts`), which sets
  `color` on every mode it produces.
- Fertile Ground (`convex/cards/sets/usg/green.ts:118`) uses `COLOR_OPTIONS`
  (`convex/cards/abilities/chooseColor.ts`), which is literally
  `COLOR_LABELS.map(([color, label]) => ({ id: color, label, color }))` — it
  sets `color` too.

The original finding was written from `chooseColor.ts`'s own historical
`COLOR_OPTIONS` doc comment ("QA: four near-identical hand-rolled … literals,
each missing the `color` tag"), which describes the state BEFORE
`COLOR_OPTIONS`/`colorChoiceModes` existed, not the code as it now stands —
that comment has been corrected in the same commit as this rewrite. Nobody
re-read the call sites before drafting the finding.

**Why this mattered.** These four cards carrying `color` is precisely the
mechanism behind review finding 1 on this PR: `colorModePrior` /
`colorModeTiebreak` keyed on the bare `color` tag, which is set by BOTH
`protectionColorModes` (protection — dodge a colour) AND
`colorChoiceModes`/`COLOR_OPTIONS` ("become a colour" — a different,
sometimes opposite, intent that issue #2306 explicitly puts out of scope).
So Kavu Chameleon and siblings were not uncovered at all — they were
OVER-covered, and steered in the wrong direction (toward the opponent's
best-shown colour, which is backwards for a colour a creature is BECOMING
rather than dodging). That defect is fixed in this same PR: both the prior
and the tie-break now gate on `protectionColor`, a field set only when the
mode's own effects structurally grant a "protection from <colour>" ability
(`gre/effects/interpreter.ts`'s `modeProtectionColor`, via the shared
`parseProtectionFromColor` parser), never on the presence of the `color`
rendering tag alone.

**Declining, not re-opening.** No gap remains to scope: these four cards are
correctly OUT of `colorModePrior`'s coverage now (as issue #2306 intended),
and the mechanism producing that gap is understood and fixed. Nothing here
needs a follow-up ticket.
