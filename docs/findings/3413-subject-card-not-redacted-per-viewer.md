---
title: PendingChoice.subjectCardId is one unredacted value for two viewers, so a hideaway controller gets no image of a card CR 406.3 entitles them to keep looking at
discoveredBy: 3413
status: draft
confidence: high
---

**What is wrong.** Issue #3413 gave the resolve-time Cast/Decline dialog a
picture of the card it asks about, gated on `getPublicCardIdentity` — which is
necessarily VIEWER-BLIND, because `subjectCardId` is a single value on a
`PendingChoice` that crosses the wire unredacted to both players. "Public"
therefore has to mean public to EVERYONE. The consequence is that the card
whose constraint drove the whole design gets nothing: a hideaway controller
(Shelldock Isle, CR 702.75a) may keep looking at their own face-down exiled
card (CR 406.3), they are the chooser, and the dialog still shows them an empty
question — because showing it to them would show it to their opponent too.
Same for any future impulse-exile-sourced offer.

**Evidence.** `SpellContext.getPublicCardIdentity` (`convex/gre/state.ts`)
refuses on `isFaceDownExile` (`convex/gre/faceDown.ts`) with no viewer
parameter, and `convex/cards/types.ts` documents why it cannot have one.
`projectExileCard` (`convex/gameProjections.ts`) already does exactly the
per-viewer thing that is missing here: it has `viewerId`, and it hands the
knower the real identity while every other viewer gets `FACE_DOWN_CARD_ID`.
`convex/cards/sets/lrw/__tests__/colorless.test.ts` asserts the current
behaviour — `subjectCardId` undefined in BOTH projections.

**The shape of a fix.** Redact `subjectCardId` per viewer in
`projectPublicState`, the way the exile pile already is, and let the engine pin
the id whenever the CHOOSER may see it. That moves the gate from "public to
everyone" to "public to this viewer", which is the correct rule and the one the
projection layer is already built for.

**Why it may not deserve its own issue.** It is a missing improvement, not a
leak — the conservative direction. It touches the projection's redaction
contract, which is load-bearing for ADR 0026 and wants its own proof-of-failure
pass rather than riding along with a dialog tweak. And the population is small:
only hideaway and a future impulse-exile offer reach it, since every other
producer of this offer (Malcolm, Chandra, cascade) sources a card that is
already public and already gets its picture. If that stays true it is a line on
a UI-polish tracker rather than a ticket.
