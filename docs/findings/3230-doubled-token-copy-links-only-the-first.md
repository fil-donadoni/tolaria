---
title: A token copy doubled by a count replacement reverse-links only its first copy
discoveredBy: 3230
status: draft
confidence: high
---

**What is wrong.** `SpellContext.createTokenCopyOf` (`convex/gre/state.ts`,
the `const [tokenId] = createTokenPermanents(...)` call) asks for ONE copy and
keeps ONE id. Since issue #3230 a CR 614 `"token-created"` replacement (Elspeth,
Storm Slayer) can turn that request into two copies. Both are created and enter
correctly, but only the first is returned (so an interpreter `bind` sees one) and
only the first is written to the creator's `linkedTokenId`.

**Evidence.** Dance of Many (`convex/cards/sets/drk/blue.ts`) is the one
consumer of `linkedTokenId`: its "When the token leaves the battlefield,
sacrifice Dance of Many" trigger matches `event.instanceId ===
self.linkedTokenId`. With Elspeth out, Dance of Many resolves into two copies;
if the SECOND copy leaves first, the enchantment stays. Its exile half is fine —
it scans by `createdBy`, which every copy carries. Surfaced by the issue #3230
review; not reproduced in a test.

**Second, related observation (same review).** `createTokenPermanents`
finishes a batch one token at a time, so token N's `entersWith` counters see
tokens 0..N-1 already on the battlefield. A token copy of a creature that has
BOTH a `"counter-placed"` replacement and entry counters would apply that
replacement to its own batch-mates. CR 614.12 checks how a permanent enters
against effects that ALREADY exist (its Orb of Dreams example: an entering
permanent does not affect itself), so a replacement carried by an object
entering alongside it should not apply. No shipped card has both halves.

**Why it may not deserve its own issue.** It needs two specific cards together
(a doubler plus Dance of Many), and the fix is a shape change to a PERSISTED
field (`linkedTokenId` → a list, `serialize.ts` + the one consumer) rather than
a local repair. If no second `linkedTokenId` consumer ships, a line on PRD
#1525 may be the right home.
