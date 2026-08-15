---
title: A graveyard→library move grants knowledge to ALL players, leaking the card's exact library position
discoveredBy: 2381
status: draft
confidence: medium
---

**What is wrong.** Any move from a public zone into a hidden one runs
`grantKnowledgeToAll`, so every player learns the moved card's identity. That is
right for the identity (the card was public a moment ago), but the library
projection carries identity **and position** together: a known library card is
projected sparsely as `{ index, … }`. The consequence is that when a card goes
from the graveyard onto the library, the opponent learns not only WHICH card it
is but exactly WHERE in the library it sits — information the CR 401.4 look
never grants them.

Doomsday (this issue) makes it very visible: the graveyard half of the five-card
pile lands face-up-known at known indices, so the opponent reads that part of the
pile off the wire. But the card only exercises pre-existing engine behaviour; it
does not introduce it.

**Evidence.** `convex/gre/state.ts:17282` `moveCardWithGraveyardReplacement` →
`convex/gre/state.ts:17295` calls `grantKnowledgeToAll(state, player.id,
[moved.id])` on every `PUBLIC_ZONES` → hidden move that is not a face-down exile
return. `convex/gameProjections.ts:143` `PublicLibrary` = `{ count, known:
KnownLibraryCard[] }` and each `KnownLibraryCard` carries its top-relative
`index` alongside the identity. Pre-existing and engine-wide: e.g. Imperial Seal
(`convex/cards/sets/ptk/black.ts:36`) moves the searched card `to:
"library-top"`, and any graveyard-sourced recursion into the library takes the
same path.

**Why it may not deserve its own issue.** Two mitigations narrow the real-world
blast radius. (1) `projectLibrary` exposes only the two CONTIGUOUS known runs
from the top and the bottom (`convex/gameProjections.ts:285-299`), so a
graveyard-sourced card buried between unknown cards reads as face-down again —
the leak only bites for cards placed at an END. (2) For the common shapes
(tutor-to-top, Regrowth-to-hand) the position is either public by the card's own
text or irrelevant. Fixing it properly means splitting "knows the identity" from
"knows the position" in the knowledge model (ADR 0026), which is a real design
change and much bigger than any one card — so this may belong as a line on the
knowledge-model tracker rather than a ticket of its own.
