---
title: The CR 614.12 land-entry prompt can never name the land in production
discoveredBy: 1980
status: draft
confidence: high
---

**What is wrong.** Every shock-land pay-choice prompt a real player sees reads
"You may pay 2 life. If you don't, **This land** enters the battlefield
tapped." The name-substitution branch is unreachable: the engine persists only
the slim `{ id }` reference in `card.card`, so the `name` the prompt builder
looks for is never there.

**Evidence.** `convex/gre/playLand.ts` `enqueueLandEntryChoice` reads
`(landCardData as { name?: string }).name ?? "This land"`. Its `landCardData`
is always a `CardInstanceState.card`, which `convex/game.ts:528` and `:551`
build as `{ id: def.id }` — no `name` field anywhere in the engine's own
instance construction (`convex/cards/__tests__/setup.ts:31` mirrors it). The
client hydrates definitions from the registry by id; the prompt string is
built server-side and crosses the wire verbatim.

**Why it may not deserve its own issue.** It is cosmetic — a grammatical wart
("If you don't, This land enters…"), not a rules divergence, and the choice's
`landInstanceId` already lets a client render the card if it wanted to. The
obvious fix (hydrate the definition server-side and interpolate the real name)
also has to re-derive the CR 406.3 redaction #1980 just added for a
still-face-down exiled land, so it is not a one-liner. A smaller fix — reword
to "…it enters the battlefield tapped" — is a UI-copy change someone should
choose deliberately, not a bug ticket.
