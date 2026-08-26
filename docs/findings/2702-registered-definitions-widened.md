---
title: registeredDefinitions() now yields ~1,429 more (compiled) entries — two consumers walk it as "every card", currently unaffected but worth a note
discoveredBy: 2702
status: draft
confidence: low
---

**What changed.** #2702 registers compiled `ready` rows through the same
`preloadDefinitions` seam `catalogue.ts` uses for hand-written cards
(`convex/cards/registry.ts`'s `registry` Map). `registeredDefinitions()`
(`convex/cards/registry.ts`) enumerates that ENTIRE map, so it now yields
~1,429 more definitions than before — deliberately, per ADR 0046's "single
registry seam, unchanged for every consumer."

**Where this could matter.** Three consumers walk `registeredDefinitions()`
looking for "every registered card": `src/lib/ai/bot-view.ts`'s
`firstLegalRegisteredName` (a name-choice fallback — picks the first
registered card matching a legality predicate); and two bot tests,
`convex/gre/__tests__/loyaltyMoves.bot.test.ts` /
`loyaltyValue.bot.test.ts`, whose `shippedPlaneswalkers()` helper filters
`registeredDefinitions()` for `types.includes("Planeswalker")` with a loyalty
activated ability, to build their "every shipped planeswalker" test matrix.

**Verified today: zero impact.** `node -e` over `data/oracle-compiled.json`
confirms zero compiled `ready` rows are Planeswalkers
(`lf.cards.filter(c => c.state==="ready" && c.definition.types?.includes("Planeswalker")).length === 0`),
so `shippedPlaneswalkers()`'s matrix is unchanged today, and both bot test
files were run green as part of #2702's pre-PR gate.

**Why it may not deserve a ticket.** Nothing is broken; this is a
forward-looking note for whoever ships the compiler's first Planeswalker (a
capability PRD #2693 doesn't scope for M1) — at that point
`shippedPlaneswalkers()` would silently start covering a compiled
Planeswalker too, which is probably DESIRABLE (the loyalty-value tests
should hold for a compiled planeswalker exactly as for a hand-written one)
but is worth a conscious look rather than a surprise, since a compiled
Planeswalker's `activatedAbilities` shape comes from the compiler's grammar,
not a hand-authored template.
