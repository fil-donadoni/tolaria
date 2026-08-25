---
title: Giver of Runes' activated ability is never enumerated for the Bot at all
discoveredBy: 2306
status: draft
confidence: high
---

**What is wrong.** The Bot can never activate Giver of Runes — not merely pick
a bad colour, but never enumerate the activation as a legal move in the first
place. Confirmed via `enumerateMoves(state, controllerId)` on a fresh board
with Giver of Runes and Grizzly Bears (its would-be target): the returned
move list is `["pass"]` only, at every priority window.

**Evidence.** `convex/gre/moves.ts:1239` (inside the ability-enumeration
loop): `if (ability.canActivate || ability.getTargetRequirement) continue;` —
any activated ability declaring a `getTargetRequirement` closure is skipped
outright. Giver of Runes (`convex/cards/sets/mh1/white.ts`) declares exactly
that (`getTargetRequirement: (source) => ({ ..., excludeInstanceIds:
[source.id] })`, for CR 109.2's "another" exclusion), so it is
structurally invisible to the search. The skip is documented as deliberate
in the surrounding comment: "Conditional abilities need a runtime predicate
we don't replicate; leave them to a later slice … (Documented limitation —
server would reject anyway.)" — but that comment undersells the effect: it
is not that some activations of Giver of Runes are illegal, it is that
_every_ activation is invisible, forever, regardless of board state.

**Why it surfaced here.** Issue #2306 (the Bot's protection-colour pick) needed
a SECOND card built on the shared `protectionColorModes` seam to prove the fix
lives at the seam and not in a Mother-of-Runes-shaped patch. Giver of Runes
was the natural second pick — the map's own producer census named it — but it
turned out unusable as a test fixture for an unrelated reason. Thornscape
Master (`convex/cards/sets/inv/green.ts`, static `targetRequirement`, no
`getTargetRequirement`) was substituted instead; see the blade entry
`protection colour choice: Thornscape Master picks the opponent's shown
colour (shared seam)` in `convex/gre/ai/blade/registry.ts`.

**Why it may not deserve its own issue yet.** `getTargetRequirement` is used
by several other cards (`grep -rl getTargetRequirement convex/cards/sets/`
turns up Giver of Runes, plus cards in `neo/`, `ori/`, `arn/`, `dka/`) — the
scope of "how many Bot-unplayable activated abilities does this gap actually
cover" wasn't measured here, and fixing the enumerator's skip would need a
real design for evaluating a `getTargetRequirement` closure generically inside
`enumerateMoves` (it needs the _candidate_ source instance, which the
enumerator has, so it may be a smaller change than the comment implies — but
that design work is out of scope for a colour-choice bug fix). Worth a
dedicated `/audit-tracker`-style census of every `getTargetRequirement` card
before scoping the fix.
