---
title: A loot's discard is scripted as two different choice kinds
discoveredBy: 4126
status: draft
confidence: medium
---

**What is wrong.** "Draw N cards, then discard M cards" is encoded two ways in
the hand-written catalogue: 12 cards raise the discard as a
`choice { kind: "choose-hand-card" }` (Jalum Tome, Bazaar of Baghdad,
Attunement, Frantic Search, …) and 3 as `kind: "discard-hand"` (Faithless
Looting, Dack Fayden, Cephalid Coliseum). Both feed the same `discard` Op. The
Oracle compiler (issue #4126) emits the majority form, so Faithless Looting is a
`KNOWN_DIVERGENCES` row in `convex/oracle/__tests__/gold.test.ts`.

**Evidence.** `src/lib/pending-choice-labels.ts` labels `discard-hand`
"Discard" and `choose-hand-card` "Choose"; `convex/gre/ai/opValuers.ts` signs
`discard-hand` harmful only when an announced target is the chooser. The
`ChoiceKind` doc in `convex/cards/types.ts` still says `discard-hand` is raised
by the engine (cleanup) and "never by a card script", which three cards
contradict.

**Why it may not deserve its own issue.** Nothing plays differently: the pick,
the zone and the discard are identical, and only the prompt header differs. A
cleanup would pick one kind (arguably `discard-hand`, whose label says what
happens), migrate the other cards and the compiler together, and drop the gold
row — a small mechanical change that could ride on any loot-touching ticket.
