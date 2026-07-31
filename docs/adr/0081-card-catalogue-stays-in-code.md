# The card catalogue stays in code — measured, with the precondition for revisiting it

## Status

accepted

## Context

The recurring proposal is to move `CardDefinition`s out of `convex/cards/sets/**`
and into the database: author cards without a deploy, edit them from an admin UI,
and drop 431 KB gzip of catalogue out of the client bundle. ADR 0045/0046 make it
look imminent — the Effect Script DSL is explicitly JSON-pure and validated as
such, so a DSL card _is_ a data row.

This came up again while designing Manual Mode (ADR 0080) and was settled with a
measurement rather than an argument. Scanning the live registry for function
values at any depth:

```
cards total:                    1872
cards with ≥1 closure:          1074  (57.4%)
JSON-pure cards:                 798  (42.6%)

  588  triggeredAbilities[].matches       ← the bottleneck
  241  staticEffects[].applies
  234  triggeredAbilities[].resolve
  167  activatedAbilities[].effect
  132  activatedAbilities[].resolve
   81  resolve
   61  triggeredAbilities[].resolveSteps[]
   45  staticEffects[].predicate
   40  resolveSteps[]
   39  staticEffects[].compute
   37  triggeredAbilities[].interveningIf
   30  staticEffects[].condition
   27  replacementEffects[].appliesTo / .replace
```

The DSL attacked the **effect** side and worked — 1353 `effects:` declarations
across the catalogue. The **predicate** side is untouched. `matches` alone is 588
closures, more than any other field: a card can carry a perfectly declarative
`effects: [...]` and still be unserializable because of its trigger predicate.
That is why purity sits at 42.6% and not at the 70–80% an `effects:` count
suggests.

## Decision

**Card definitions stay in code.** Two things must land before the question is
worth reopening, and they are the record's real content:

1. **A predicate DSL** — declarative forms for `matches`, `applies`,
   `interveningIf`, `appliesTo`, `condition`, `compute`, `canActivate`. This is a
   project of the same order as ADR 0045, not a cleanup pass. Without it,
   "definitions in the DB" means a hybrid registry (code for predicates, rows for
   the rest), which is strictly worse than either pure option.
2. **A replacement for the catalogue-wide CI guards.** `mechanicsRegistry`,
   `effectScripts`, `divergenceMarkers`, `tokenPrintLookup`, `pickRatings`,
   `aiEffectsGuard` and the move/profile censuses all run **statically against
   the in-code registry**. With definitions in the DB, CI has nothing to check
   without an exported snapshot — and those guards are the project's main safety
   net, the thing that catches a shipped-but-inert keyword or an uncensused
   mechanic before a human does.

`resolve()` cards (~10–15% of the pool by design, ADR 0045) are permanently
outside any data representation, so a code path for them survives either way.

## Consequences

- The bundle cost stands on its own and is being addressed separately: a game
  uses ~120 distinct cards while the client ships all 1872 (1.63 MB raw / 431 KB
  gz, ~44% of the main bundle). Code-splitting, or fetching only the definitions
  in play, recovers that **with the source unchanged and the CI guards intact** —
  which is the actual prize people are reaching for when they propose the DB.
- Progress is measurable: re-run the purity scan. The number to watch is the
  share of cards with zero closures, and the single lever that moves it most is
  `triggeredAbilities[].matches`.
- Manual Mode does not depend on this in any direction (ADR 0080): its catalogue
  is a generated client asset with no mechanics in it at all.
