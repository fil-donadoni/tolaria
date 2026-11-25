---
title: a hand-activated ability with {X} in its cost has no X dialog on the client
discoveredBy: 10498
status: draft
confidence: high
---

**What is wrong.** A human cannot announce X for an ability activated from the
hand, so the compiler refuses `{X}…, Discard this card: …` (Jiwari, Arashi,
Shigeki, Ghost-Lit Drifter, Roaring Earth).

**Evidence.** `activateHandAbility` in `src/components/board/gre-hand-card.tsx`
sends no `chosenX`; the battlefield path opens the dialog
(`useBattlefieldInteraction.tsx`). The server then throws "This ability requires
a chosen X value" (`convex/gre/activation.ts`). The refusal is in
`lowerActivatedAbility` (`convex/oracle/lowerActivated.ts`).

**Why it may not deserve its own issue.** Five corpus cards, none in a ranked
Target today, and nothing playable is affected: the form fails closed.
