---
title: moveZone's exiledWithSource shape breaks 2+-candidate ties deterministically, not by player choice
discoveredBy: 1323
status: draft
confidence: medium
---

**What is wrong.** Emperor of Bones' reanimation clause ("put a creature card
exiled with this creature onto the battlefield") is implemented via a new
`moveZone` target shape (`target: { exiledWithSource: true }`,
`convex/cards/types.ts`, the `EffectExiledWithSourceSelector` union member) and
its resolver `resolveExiledWithSource` (`convex/gre/effects/interpreter.ts`).
When 2+ creature cards are simultaneously linked to the same source (Emperor's
own "exile up to one target card from a graveyard" ability can fire once per
combat, so several can pile up before Adapt first resolves), the resolver
deterministically picks the FIRST match in `getCardsExiledWith`'s stable
return order (players in seat order, then each player's exile in
insertion/link order) — it never prompts the controller to choose.

The general CR 601.2c/608.2 default, when an effect's wording doesn't specify
a selection method among several equally-valid options, is "the appropriate
player chooses." Emperor's own printed Oracle text has no "your choice" or "at
random" qualifier, and no Gatherer ruling clarifies the multi-candidate case
either. This shape mirrors the FIFTH `moveZone` shape's own explicit
precedent (`EffectZonePositionSelector` / Shallow Grave, `mir/black.ts`:
"Deliberately NOT a player choice: substituting one would diverge from the
modern oracle text") — but that precedent is CR-clean because a graveyard
genuinely has a defined order (CR 404.3); an exile zone does not, so applying
the same "no choice" shape here is a real (if minor) simplification, not a
like-for-like reuse.

**Evidence.**

- `convex/cards/types.ts` — the SIXTH `moveZone` shape's doc comment
  ("DELIBERATELY NOT a player choice when multiple cards qualify...") states
  the simplification explicitly.
- `convex/gre/effects/interpreter.ts::resolveExiledWithSource` — the
  first-match loop with no suspend/choice path.
- `convex/cards/sets/mh3/black.ts` (Emperor of Bones) — the only current
  consumer; its own doc comment flags the same tradeoff.

**Why it may not deserve its own issue.** Building genuine player-choice
support here is a real (if bounded) engine widening: it needs the `choice`
Op's `zone: "exile"` candidate-discovery path to source candidates from
`getCardsExiledWith` (a multi-owner pile) instead of a single `zoneOwnerId`'s
own exile zone, plus a `controller` override on the reanimation step so the
picked card still enters under the ability's controller regardless of whose
exile it left. That is squarely a "parametrize an existing shape" change
(no new Op, no new choice kind name), but it is unexercised until a SECOND
card actually needs it — Emperor is the sole `exiledWithSource` consumer
today, and the common case in play (0 or 1 linked creature at resolution
time) never hits the tie at all. If a future card needing this same clause
against a MULTI-candidate pool ships (or Emperor is later found to reach 2+
in practice often enough to matter), the fix composes cleanly with the
existing `choose-exile-card` `EffectChoiceKind` infrastructure Dauthi
Voidwalker already exercises — worth a ticket AT THAT POINT, not speculatively
now.
