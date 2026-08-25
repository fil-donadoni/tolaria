---
title: The ui-gate probe scores a depth-pile's covered faces as occluded cards
discoveredBy: 2725
status: draft
confidence: medium
---

**What is wrong.** A permanent stack above the depth-pile threshold mounts
**every** member inside one card footprint —
`src/components/board/battlefield-stack-depth-pile.tsx:66-87` renders all `n`
members, each translated by `stackDepthOffset(i)` (4px, capped at 6 edges), with
`pointerEvents: "none"` on everything but the top face. That is the intended
look: a small deck of cards. But the ui-gate probe counts card IMAGES
(`scripts/ui-gate/probe.js:252-256`, `cards: probe(imgs)`) and hit-tests each
one's centre (`scripts/ui-gate/probe.js:161-165`), so an `n`-member pile
contributes **n−1 `occ`** — for the 9-Mountain pile this PR adds to the
`game-stress` payload, +8.

**Why it matters now.** `game-stress` is the surface that is supposed to make
the battlefield budgetable (`scripts/ui-gate/budgets.json`, the `game-stress`
`reason`), and it is still `status: "unwalked"` — so nothing is red today. The
moment someone records its ceilings, those 8 by-design occlusions are baked into
the recorded `cardsOcc`, and the number stops meaning "cards a player cannot
read". A later payload that deepens or removes a pile then moves the ceiling for
reasons that have nothing to do with a layout regression.

**Evidence.** `battlefield-stack-depth-pile.tsx:66` (`members.map`, all of them,
no slice) versus `src/components/board/cards-pile.tsx:708-714`, where the
graveyard/exile pile solves the same problem by mounting only its last
`COLLAPSED_DEPTH = 3` cards — the same visual, three nodes instead of `n`.

**Why it may not deserve its own issue.** It is invisible until `game-stress`
budgets are recorded, and it has two quite different fixes with different owners:
teach the probe to skip a `[data-stack-pile-collapsed]` face that is not the top
one (a lane change), or cap the pile's mounted members the way `CardsPile`
already caps its own (a rendering change that also drops 6 DOM nodes per big
land stack). Deciding that is a design call, not a bug fix — it may be better
recorded as a note on the `game-stress` budget row than as a ticket.
