---
title: A token copy never owes the COPIED card's as-enters choices — CR 614.12's own worked example
discoveredBy: 2019
status: draft
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
example is a token copy of Voice of All — the exact card #2019 is about"). If
#2451 routes `createTokenCopyOf` through the `copy` kind rather than through
`applyCopy` directly, this closes for free and a separate ticket is noise. It is
worth a comment on #2451 rather than a ticket — unless #2451 lands without
touching `createTokenCopyOf`, in which case it is a real standing gap with ten
cards behind it.
