---
title: the shared as-enters `subtypes` submission path rejects a duplicate pick, narrowing Illusionary Terrain's legal choice space
discoveredBy: 2467
status: draft
confidence: low
---

**What is wrong.** Illusionary Terrain's Oracle text ("As this enchantment
enters, choose two basic land types. Basic lands of the first chosen type are
the second chosen type.") does not say "two DIFFERENT basic land types" — so
choosing the same type twice (e.g. Forest, Forest) is a legal, if pointless,
answer under CR 614.1c. The generic as-enters submission path this issue wires
Illusionary Terrain onto rejects it: `applyPendingChoiceSubmit`
(`convex/gre/pendingChoiceSubmit.ts:638-642`) runs
`new Set(args.cardInstanceIds).size !== args.cardInstanceIds.length` — throws
"Duplicate ids in submission" — on EVERY as-enters `option-pick` submission,
including a `subtypes` choice with `count: 2`, before the choice-specific
validation even runs.

**Evidence.** `convex/gre/pendingChoiceSubmit.ts:638-642` (the shared
`count`-validated as-enters branch) vs. Illusionary Terrain's declaration
(`convex/cards/sets/ice/blue.ts`, `entersWith.asEnters`, `{ kind: "subtypes",
from: [...BASIC_LAND_SUBTYPES], count: 2 }`) — no per-kind override exists to
admit a repeated id for `subtypes` specifically.

**Why it may not deserve its own issue.** Choosing the same type twice is
functionally a no-op — "basic lands of Forest are Forest" changes nothing on
the battlefield — so the player never loses a MEANINGFUL choice, only a
degenerate one with zero game impact. The duplicate-id rejection is also the
generic seam's own invariant (shared by every `option-pick`-shaped as-enters
kind, not something this issue's wiring introduced), so relaxing it is a
seam-wide decision, not a Illusionary-Terrain-specific fix — and it is
unclear any OTHER as-enters `subtypes` card (present or future) would ever
want a repeated pick to be legal. Flagging for triage rather than fixing
inline, since "generalize, don't special-case" argues against carving a
per-kind exception into the shared validator for a change with no observable
game effect.
