---
title: An "until" exile's source-on-battlefield guard matches a blinked source by its reused instance id
discoveredBy: 4526
status: draft
confidence: medium
---

**What is wrong.** An "exile … until this leaves the battlefield" ETB trigger
must exile nothing if its source has left before it resolves (CR 610.3b).
`exileWithAttachments` checks that with `findOnBattlefield(state, sourceId)`
(`convex/gre/state.ts`, `requireSourceOnBattlefield`), but instance ids survive
a zone change (the same file says so a few lines up). So if a Banishing Light
is flickered while its first ETB trigger is still on the stack, the old trigger
finds the NEW object under the same id and exiles its target anyway, keyed to
the new object. The new object's own ETB then exiles a second target.

**Evidence.** Seen in review of issue #4526's PR. The comment above the guard
claims the "blink hole" is closed, but it closes it only for the
`isOwnResolvingSpell` branch, not for the battlefield lookup. The hand-written
Banishing Light already behaves this way, and issue #4526 makes about 30
compiled "until" cards (Banisher Priest, Portable Hole, Stasis Snare, …) reach
the same path.

**Why it may not deserve its own issue.** It needs a blink effect to resolve
inside the window of a pending ETB trigger. That's a rare line, and the fix is
an engine identity question (does a zone change mint a new id, CR 400.7?)
rather than a grammar one. It may belong on an existing CR 400.7 /
object-identity tracker rather than in a ticket of its own.
