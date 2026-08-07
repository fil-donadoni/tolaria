---
title: manualBandOf's card shape has no ready-made mount point on the shared battlefield's bandOf parameter
discoveredBy: 2168
status: draft
confidence: medium
---

**What is wrong.** PRD #2162's "Battlefield row classification" section says
the band classifier "becomes a parameter of the battlefield component" so the
GRE board and the Manual board can each pass their own. The GRE board's
classifier (`bandOf` in `src/components/board/board-battlefield.tsx:67`) reads
`isCreature(card: CardInstance)`. `manualBandOf` (`src/lib/manual-band.ts`),
built in this issue, instead needs `card.lane` — a field that exists on
`ManualCardInstance` / `ProjectedManualCard` (`convex/manual.ts`) but **not**
on the board's `CardInstance` type (`src/types/game.ts:141`), because `lane`
is a manual-only concept (ADR 0080: "no free x/y positioning ... one
`lane: 'main' | 'combat'` field").

So when #2169 wires the classifier in as an injected parameter of the
battlefield component, the two classifiers' input types will not unify under
a single `(card: CardInstance) => BandKey` signature unless `lane` is added to
`CardInstance` (optional, ignored by the GRE side) — or the battlefield
component's classifier parameter is typed against a shape narrower than the
full adapted `Player.battlefield` entry.

**Evidence.** `src/lib/manual-band.ts` — `ManualBandCard` is `{ card: { id },
lane? }`, deliberately NOT `CardInstance`, because `CardInstance` (
`src/types/game.ts:141`) has no `lane` field. `src/components/board/
board-battlefield.tsx:67` — `bandOf(card: CardInstance)`.

**Why it may not deserve its own issue.** This issue's scope was explicitly
the two pure functions with no UI ("Do not touch `manual-board.tsx` — the
swap is issue #2169"), so the exact battlefield-component plug-in shape is
#2169's decision to make, not this one's. It may resolve itself trivially
(#2169 could classify off the RAW `ProjectedManualCard` before calling
`adaptManualPlayer`, sidestepping the type-unification question entirely,
since the manual board already has both shapes in hand at the point it needs
to lay out the battlefield). Flagging here only so #2169 doesn't discover the
mismatch mid-implementation.
