---
title: A token copy never owes the COPIED card's as-enters choices — CR 614.12's own worked example
discoveredBy: 2019
status: triaged
issue: 2558
confidence: medium
---

**What is wrong.** CR 614.12's example is _"An effect creates a token that's a
copy of Voice of All. As that token is created, the token's controller chooses a
color for it."_ That does not happen. `SpellContext.createTokenCopyOf`
(`convex/gre/state.ts:14375`) mints the token from a **minimal placeholder
spec** and only then overwrites its copiable characteristics with `applyCopy` —
but the CR 614 chokepoint runs **inside** `createTokenPermanents`, before the
copy is applied, and it is handed `{ declaredEntersWith: spec.entersWith }`
(`convex/gre/state.ts:17856`), i.e. the placeholder's clause, never the copied
card's. So a token copy of any of the ten cards wired in #2019 enters with no
`chosenModeId`: Voice of All has protection from nothing, Prismatic Ward's shield
never fires, Quirion Elves' second mana ability produces nothing.

**Evidence.**

- `convex/gre/state.ts:17856` — `{ declaredEntersWith: spec.entersWith }`, the
  spec being the placeholder built by `createTokenCopyOf`.
- `convex/gre/state.ts:17795-17801` — the synthesized token definition carries
  `entersWith.asEnters` **from the spec**, with the comment "a permanent
  entering as a COPY of this token discovers them off the definition it now
  presents (CR 707.6)" — which is the copy-recipient direction, not this one.
- `convex/gre/state.ts:11215` `refreshOwedAsEnters` is the mechanism that would
  close it (ADR 0100 D4: an answered `copy` re-reads the copied definition's
  clauses and appends them), and it is reached only from the `copy` as-enters
  kind — which no path raises for `createTokenCopyOf`.
- Reproduces with any Dance of Many-shaped effect naming one of the ten cards.

**Why it may not deserve its own issue.** ADR 0100's slicing table already
assigns the `copy` leg to **#2451** (slice 4), and D6 explicitly scopes token
copies in ("Census row C is already a chokepoint caller… CR 614.12's own worked
example is a token copy of Voice of All — the exact card #2019 is about"), so
the gap is squarely inside the umbrella PRD **#2043** and a separate ticket may
just be noise on top of it.

**Update (2026-08-18, #2019 review round 2).** #2451's PR (**#2546**) landed the
`copy` leg **without** routing `createTokenCopyOf` through the `copy` as-enters
kind — it independently reached the same conclusion and also deferred token
copies. So nothing shipped closes this: it is a live standing gap with ten cards
behind it, and the in-code marker on `voiceOfAll` (`convex/cards/sets/pls/
white.ts`) now carries `tracked-by: #2043` rather than pointing at a slice that
does not fix it. Triage is whether #2043 gets a dedicated slice for
`createTokenCopyOf`, not whether the gap exists.

**Resolved (2026-08-19, #2558).** The token-copy primitive now stamps the copy
onto the token INSIDE `createTokenPermanents`, before the CR 614 chokepoint
reads it (CR 707.5: "becomes a copy as it enters the battlefield"), and the
chokepoint is handed `card: token.card` so its presented-definition branch sees
the copied card's `entersWith.asEnters`. The `createTokenCopy` Op gained the
ADR 0100 D5 replay marker its `createToken` sibling already carried. Guarding
tests: `convex/gre/__tests__/asEntersTokenCopy.test.ts`.
