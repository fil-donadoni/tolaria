---
title: The no-stack mana path has no removeCounter cost leg, so counter-fuelled mana rocks ship as CR 605.1a divergences — and Pentad Prism makes that cost real
discoveredBy: 2378
status: draft
confidence: medium
---

**What is wrong.** `activateManaAbility` (`convex/game.ts`) — the no-stack
route CR 605.3a mana abilities take — pays only `cost.mana` and
`cost.tapOtherFilter`. It has no `removeCounter` leg. So an ability whose cost
is "remove a counter" cannot be authored as a real mana ability: doing it would
add the mana and never remove the counter (unbounded mana). The workaround both
affected cards use is `useStack: true`, which pays the counter correctly
(`payRemoveCounterCost`, reached by `applyMove` and `activateAbility`) at the
price of a documented CR 605.1a divergence.

The divergence now stands on **two** cards with no tracking issue for the
underlying gap:

- Jeweled Amulet (`convex/cards/sets/ice/colorless.ts:1125`) — the original,
  where the deviation is mostly academic (a battery you charge and cash later).
- Pentad Prism (`convex/cards/sets/5dn/colorless.ts`) — where it is not. The
  Prism is a ramp rock whose entire printed purpose is paying MID-CAST: CR
  605.3a explicitly permits activating a mana ability "in the middle of casting
  a spell", which is how you cast a four-drop off two lands and a Prism.
  `useStack: true` makes exactly that impossible. The player must float the
  mana at priority BEFORE announcing the spell, and doing so opens a response
  window (the ability sits on the stack) that a real mana ability would never
  open. The floating-first workaround is also precisely the flow that surfaced
  the capture bug this PR fixes — it is a well-trodden path, not a corner.

**Evidence.**

- The cost legs the no-stack path accepts:
  `convex/game.ts:13768-13791` (`getActivatedManaAbility` branch of `tapUntap`
  and its "Use activateManaAbility for non-tap mana abilities" bounce) — mana
  and tap only.
- Pentad Prism's flagged simplification, with the reasoning:
  `convex/cards/sets/5dn/colorless.ts:45-59`.
- Jeweled Amulet's identical flag: `convex/cards/sets/ice/colorless.ts:1137` (and its sibling flag at `:834`).
- CR 605.1a makes the Prism's ability a mana ability by every criterion (no
  target, could add mana, not loyalty, no library movement); CR 605.3a is the
  timing clause the `useStack: true` route breaks.

**Why it may not deserve its own issue.** Two cards is a thin base for
extending a hot path everyone's mana payment goes through, and the divergence
is flagged, tested and understood on both. Against that: this is a
**capability** gap, not a card quirk — every future "remove a counter: add
mana" rock (Astral Cornucopia, Everflowing Chalice's cousins, Doubling Cube's
family of charge-fuelled rocks) will hit it and copy the same workaround, and
the workaround costs strictly more the more the card wants to be used
mid-payment. Treating it as a line on a cost-system tracker ("`cost` legs the
no-stack mana path cannot pay: `removeCounter`, `sacrifice`") is probably the
right size; a standalone ticket is defensible the moment a third card lands or
a player complains that the Prism cannot pay for a spell.
