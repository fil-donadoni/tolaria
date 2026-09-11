---
title: A fixed-count search-library choice cannot express a deliberate CR 701.23b fail-to-find
discoveredBy: 3425
status: draft
confidence: medium
---

**What is wrong.** CR 701.23b — "that player isn't required to find some or all
of those cards even if they're present in that zone" — is modelled only for the
`search-library` Ops that declare a `{ min, max }` count with `min: 0`. About
half the shipped ones declare a FIXED `count` instead, and for those the picker
demands exactly that many cards whenever the library holds them: the player
cannot legally decline a card they can see, which is a rule the CR grants them
unconditionally on a hidden zone.

**Evidence.** `convex/gre/effects/interpreter.ts` (the `choice` Op's library
branch) clamps a numeric `count` to what is available and returns early at
zero; only `searchWithNoHit` — the case where the filter matches NOTHING —
forces `{ min: 0, max: 0 }`. So a fixed-count search comes back empty only when
the library contains no match at all. Every fetchland (Arid Mesa, Flooded
Strand, Prismatic Vista, Fabled Passage) plus Demonic Tutor, Entomb, Intuition
and Natural Order are in that set.

Practically this matters most for a fetchland: declining to find is a real
Legacy/Vintage line (against Ashiok, Dredger of Souls, or to keep a shuffle
effect live), and the engine cannot express it.

**Why it may not deserve its own issue.** The fix is one field per card
(`count: 1` → `count: { min: 0, max: 1 }`) across ~29 definitions, which is a
sweep, not a mechanism — and issue #3425's own fail-to-find announcement is
identical either way, so nothing about the visibility work is blocked. It may
belong as a line on an existing tutor/search tracker rather than a ticket of its
own. The counter-argument: it is a CR subrule shipped PARTIALLY, which
`gre-development.md` § DSL-first authoring treats as a defect in itself.
