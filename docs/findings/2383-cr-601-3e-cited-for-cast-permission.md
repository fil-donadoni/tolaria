---
title: "CR 601.3e is cited across the cast-from-exile machinery for a rule about alternative CHARACTERISTICS — the permission rule is plain CR 601.3"
discoveredBy: 2383
status: triaged
issue: 2972
confidence: high
---

**What is wrong.** `bun run cr 601.3e` prints: "Some rules and effects state
that an alternative set of characteristics or a subset of characteristics are
considered to determine if a card or copy of a card is legal to cast." Its two
examples are Garruk's Horde and Melek, Izzet Paragon — the rule is about which
CHARACTERISTICS a cast is judged against, not about being allowed to cast from
a non-hand zone.

The rule that licenses "you may cast that card for as long as it remains
exiled" is plain **CR 601.3**: "A player can begin to cast a spell only if a
rule or effect allows that player to cast it and no rule or effect prohibits
that player from casting it."

`CR 601.3e` is nonetheless the citation attached to essentially the whole
cast-from-exile / cast-from-graveyard family: `CardInstanceState.
castableFromExileBy` and its riders (`convex/gre/state.ts`), the
`grantCastFromExile` / `grantCastFromGraveyard` rows in
`convex/cards/mechanicsRegistry.ts`, their `OP_SCHEMAS` entries
(`convex/gre/effects/validate.ts`), several branches of `getLegalActions`
(`convex/gre/rules.ts`), and the `ExileCastButton` component
(`src/components/board/exile-cast-button.tsx`) — dozens of sites.

**Why the guard cannot see it.** `bun run cr:lint` (in `check:guards`) asks
only whether an id RESOLVES, plus a keyword-vs-section-title scan for the
701/702 blocks. `601.3e` resolves and is outside 701/702, so a resolvable-but-
wrong id in this position is exactly the blind spot `docs/agents/gre-guards.md`
§ CR citation linting documents.

**Suggested slice.** A mechanical pass rewriting `CR 601.3e` → `CR 601.3` at
the cast-permission sites, leaving genuine alternative-characteristics
citations (if any exist) alone. Cheap, no behaviour change, and it stops the
next card from copying the wrong id — issue #2383 propagated three fresh
instances before this was noticed.
