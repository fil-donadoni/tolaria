# ADR 0014 — Set files carry both reprints (CardPrint) and new cards (CardDefinition)

**Status:** Accepted (2026-06-15)

## Context

`lea.ts` (Alpha) holds full `CardDefinition`s — the mechanics. `leb.ts`
(Beta) was originally written as a **reprint-only** file: every entry was a
`CardPrint` (`printId` → `definitionId` → a LEA `CardDefinition`), declaring
only the per-edition Scryfall UUID used for art. Its header asserted "entries
below only declare the per-print Scryfall UUID", and a closing note claimed
there were no LEB-exclusive cards.

That assumption is false. Beta is a near-superset of Alpha, not a subset: two
cards were printed for the first time in Beta and never existed in Alpha —

- **Volcanic Island** — the tenth ABUR dual ({U}/{R}); Alpha shipped only nine.
- **Circle of Protection: Black** — completes the CoP cycle; Alpha omitted it.

These have no LEA `CardDefinition` to point a `CardPrint` at. They need their
own definitions, and those definitions have to live somewhere.

## Decision

A set file is a **mix** of two entry kinds, and that is the general model for
every future set:

- **`CardPrint`** — a reprint of a card whose mechanics already live on a
  `CardDefinition` in an earlier set. Declares `printId` (edition art),
  `definitionId` (the shared mechanics), and `setCode`.
- **`CardDefinition`** — a card **first implemented in this set**. Declares
  full mechanics. Its `id` is its own Scryfall id for that printing; with a
  single printing there is no separate `CardPrint`.

`leb.ts` therefore gains two `CardDefinition`s (Volcanic Island, Circle of
Protection: Black) alongside its `CardPrint` reprints. `index.ts` already
aggregates definitions via `Object.values(set).filter(isCardDefinition)` and
prints separately, so both kinds in one file register without any change to
the registry.

The two new definitions reuse the existing `makeDualLand` and
`makeCircleOfProtection` factories. `makeCircleOfProtection` was a private
helper in `lea.ts`; with a second consumer it moved to
`convex/cards/abilities/index.ts` beside `makeDualLand` (rule-of-two
extraction, `feedback_extract_after_second`), and its `color` parameter was
widened from the four Alpha colors to the full `Color` union so Black is
expressible.

## Rationale

1. **Reprints stay cheap.** The `CardPrint` indirection is still the right
   tool for the ~99% case where Beta just re-arts an Alpha card. We are not
   duplicating mechanics.
2. **Set-origin stays colocated.** A card first printed in Beta has its
   definition in the Beta file — you read one file to see everything that set
   introduced, mechanics included. The alternative (a separate
   "beta-original" file, or back-dating the def into `lea.ts`) splits a set's
   identity across files or misattributes the card to Alpha.
3. **Generalises.** Every real-world set is some reprints + some new cards.
   Encoding that shape now means later sets need no new convention.

## Consequences

- `leb.ts` header rewritten to describe the prints + definitions structure.
- `makeCircleOfProtection` is now exported from `convex/cards/abilities`.
- "Set complete" is judged over both kinds: a set is complete when every card
  in its canonical catalogue is either an active `CardPrint`, an active
  `CardDefinition`, or a documented exclusion (see ADR 0010).

## Out of scope

- A `setCode`/origin field on `CardDefinition`. Set membership for a
  definition is implicit in which file declares it; nothing in the engine
  needs to query "which set did this card debut in" yet.

[adr-0010]: ./0010-lea-out-of-scope-cards.md
