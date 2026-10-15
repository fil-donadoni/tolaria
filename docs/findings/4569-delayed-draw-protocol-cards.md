---
title: Clairvoyance and Portent are protocol cards the compiler now reads whole
discoveredBy: 4569
status: draft
confidence: medium
---

**What is wrong.** The imperative delayed draw ("Draw a card at the beginning
of the next turn's upkeep") is now a compiled form, so Clairvoyance and Portent
compile to `lookHand` / `scryReorder` + `libraryLook` with an inline
`delayedTrigger`. Their hand-written twins stay `resolveSteps` closures on the
legacy `delayedTriggers` seam, and sit in `gold.test.ts` `KNOWN_DIVERGENCES`
because the schedule lives outside the body the harness exempts.

**Evidence.** `convex/cards/sets/ice/blue.cards.ts` (`clairvoyance`,
`portent`); `convex/oracle/__tests__/gold.test.ts` `KNOWN_DIVERGENCES`.
Clairvoyance's `revealHand` is a display-only dismiss, `lookHand` a silent
`markKnown`; Portent's `reorder-library` choice kind is not `scryReorder`'s
`order-top`. Migrating either changes a wire-visible choice.

**Why it may not deserve its own issue.** Two cards, and the migration is a
behaviour decision (which choice UI wins), not a mechanical rewrite — a line on
the DSL-migration tracker rather than a ticket of its own.
