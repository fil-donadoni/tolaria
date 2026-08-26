---
title: The stacked Draft Room's Pool band starves its own Mana-Value column at tablet portrait
discoveredBy: 2822
status: draft
confidence: high
---

**What is wrong.** At `820x1180x2` the Draft Room's Pool band is 287px tall,
and the `DeckZoneSurface` scroller inside it gets 201px of card area around a
358px Mana-Value pile column. That is the probe's `starved` shape — a scroll
container shorter than the tallest thing inside it (`probe.js`, the
deck-builder bug class from #2511) — and it is the single `starved 1` every
`draft-*` row at that viewport carries.

**Evidence.** Measured on `fix/issue-2822` rebased onto #2833, by logging
`probe.starved`'s own example rows out of `scripts/ui-gate/index.ts` for one
run:

```
STARVEDEX [{"cls":"flex overflow-auto md:snap-none p-3 md:p","h":201,"tallest":358}]
```

`cls` resolves to `src/components/deckbuilder/deck-zone-surface.tsx:674`. The
band above it is `[data-slot=draft-stacked-pool]`
(`limited-draft-table.tsx`), whose floor `min-h-[17.5rem]` = 280px was chosen
in #2820 round 3 as an empirical clearance over the pool pane's ~233px
intrinsic minimum — i.e. over the pane's HEADER-plus-one-row minimum, not over
a full pile column. The band itself measures 287/287 here
(`scrollHeight === clientHeight`), so the band is not the thing that overflows;
its child is.

**Why the earlier note on that row was wrong.** Both #2833's own budgets prose
and the pre-rebase #2822 recording attributed this `starved 1` to the
`<main>`-as-page-scroller false positive
(`docs/findings/2582-ui-gate-main-scroller-starved.md`). It is not: `<main>`
measures 1180/1180 at this viewport and is not a scroller at all. #2833 said
outright that it had not re-verified the source; this is that verification.

**Why it may not deserve its own issue.** It is arguably already inside
#2820's scope — that issue chose the 280px floor and its round-3 commit
records the derivation — and the number is a judgement call about how much of
a 1180px-tall tablet the Booster band should keep. Nothing is unreachable
either: `cardsStranded 0` at this viewport, the zone scrolls, and the pool's
far extent is now measured (`draft-pool-stop`). Against that: 201px around a
358px column means a user at tablet portrait sees roughly half a pile column
without scrolling, which is the same "a collapsed row passes every happy-dom
test there is" shape the whole lane exists to catch, and the floor was derived
against a pane minimum that predates a realistic 24-card pool being measured
at all.
