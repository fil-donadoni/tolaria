---
title: The catalogue DeckBuilder's SaveDeckBar is not pinned the way issue #2275 pinned PoolDeckBuilderForm's
discoveredBy: 2275
status: draft
confidence: low
---

**What is wrong.** Issue #2275 fixed `PoolDeckBuilderForm`
(`src/components/deckbuilder/pool-deck-builder-form.tsx`) by wrapping every
child that can outgrow its box (header, basics bar,
`PoolDeckbuilderSurface`) in its own `overflow-y-auto` region and moving
`SaveDeckBar` to a `shrink-0` sibling outside it — a structural guarantee
that the Done action's row always renders at its full natural height,
independent of viewport height. The catalogue-wide `DeckBuilder`
(`src/components/lobby/deck-builder/deck-builder.tsx:687-959`) shares
`SaveDeckBar` and the same overall shape (header → content → legality panel
→ `SaveDeckBar`, all siblings in one un-wrapped flex column under `<main>`)
but was **not** given the same pin — `SaveDeckBar` there is still just the
second-to-last flex child with no `shrink-0` and no scroll wrapper standing
between it and the content above.

**Evidence.** `deck-builder.tsx:827-895` (the `ResultsGrid` /
`DeckPileArea` grid) doesn't carry `PoolDeckbuilderSurface`'s hardcoded
`minHeight` — the issue #2275 body explicitly scopes that grid out for
exactly this reason ("unless it shares the same allocation path") — but a
CSS Grid `1fr` track still defaults to a `min-content`-based implicit
minimum unless `minmax(0, 1fr)` is used, and neither `ResultsGrid` nor
`DeckPileArea` sets an explicit floor that rules that out. At a short enough
viewport their own min-content size (a card row, a pile header) could still
exceed the leftover space the same way `PoolDeckbuilderSurface`'s did, and
because `SaveDeckBar` here is unpinned, the same "spills into `<main>`'s
fallback scroll" shape from #2275 could recur — just at a different,
unmeasured crossover height.

**Why it may not deserve its own issue.** Nobody has measured whether this
actually happens — no browser pass, no reported symptom, and issue #2275
explicitly carved the catalogue builder out of scope because it doesn't
share `PoolDeckbuilderSurface`'s specific forced-`minHeight` mechanism. This
is a structural-similarity observation, not a confirmed bug: a Grid `1fr`
track's min-content floor from a card tile / pile header is likely much
smaller than the Pool surface's 156.8px constant, so the crossover (if it
exists at all) may sit at an unrealistically short height nobody hits in
practice. Worth a browser measurement at a short viewport (the #2056/#2275
852x-under-300 class) before cutting a ticket — if it doesn't reproduce, it
isn't a gap; if it does, the exact same wrap-and-pin shape from this PR
applies directly.
