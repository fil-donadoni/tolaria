---
title: SPELL_CAST colours come from the mana cost alone, so a cast spell's colour indicator or layer-5 change is invisible to colour-filtered cast triggers
discoveredBy: 4135
status: draft
confidence: medium
---

**What is wrong.** `emitSpellCastEvent` sets `spellColors` from `getColorsFromCost(def.manaCost)` (`convex/gre/state.ts:12174`). A spell whose colour comes from a colour indicator (CR 105.2, e.g. a suspended Ancestral Vision cast from exile) or from a layer-5 effect reads as colourless, so "whenever a player casts a blue spell" misses it and "a nonblue spell" fires on it.

**Evidence.** Surfaced by the review of PR #4194, which makes 30 more phrases reach this filter through the compiler. The same hole already sits under Ugin's `excludeColors` (`convex/cards/sets/tdm/colorless.ts:128`).

**Why it may not deserve its own issue.** No shipped card is cast with an indicator colour today; it becomes a ticket if one is. A line on the colour-characteristics tracker is enough until then.
