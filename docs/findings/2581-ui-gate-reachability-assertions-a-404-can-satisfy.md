---
title: Four ui-gate surfaces assert reachability with selectors the 404 page also satisfies
discoveredBy: 2581
status: draft
confidence: high
---

**What is wrong.** Each `bun run check:ui` surface ends its walk with a
reachability assertion — if it fails, the row prints `UNWALKED` and reds the
run. Four of the six walked surfaces assert something the **not-found page
also renders**, so a route that moves would be measured on the 404 screen and
reported `PASS`:

| surface               | site                              | assertion                             | 404 renders it? |
| --------------------- | --------------------------------- | ------------------------------------- | --------------- |
| `lobby`               | `scripts/ui-gate/surfaces.ts:207` | `main, [role=main]`                   | yes             |
| `deck-builder`        | `scripts/ui-gate/surfaces.ts:217` | `input, button`                       | yes             |
| `limited-list`        | `scripts/ui-gate/surfaces.ts:286` | `main, [role=main]`                   | yes             |
| `limited-your-events` | `scripts/ui-gate/surfaces.ts:296` | `main, [role=main]`                   | yes             |
| `design-system`       | `scripts/ui-gate/surfaces.ts:238` | `h1:has-text('Design system census')` | no              |

This is not hypothetical. The `design-system` row was written with a
`main`-only assertion, measured a green `PASS` on the 404 page at the wrong
path, and was caught only because the numbers looked implausibly clean; that
is why its walk asserts the census **heading** today
(`surfaces.ts` carries the note). The same hole is still open on the four
older rows, and it is worse there than it was for the census page: `lobby` and
`deck-builder` are the surfaces carrying the lane's real known-debt ceilings,
so a silent fall-through to the 404 screen would not just lose coverage — it
would report every one of those ceilings as comfortably met. The two `limited`
rows are the lane's only all-zero rows, which is exactly what a 404 measures.

**Fix shape.** Pin every surface to a selector only that surface can produce,
the way `design-system` now is — e.g. the lobby's own deck-row heading or
`Solo Game` control, the deck builder's zone title / search field by
accessible name rather than the bare tag names `input, button`, and the two
Limited pages by their own headings. Generalising
it: a reachability assertion whose selector matches the 404 page is a
coverage hole by construction, so the lane could grow a guard that navigates
to a deliberately bogus path once and fails any surface whose assertion
passes there.

**Why it may not deserve its own issue.** It is small, and it is a bug in
#2580's lane rather than in the product — no user sees it, and it only bites
on the day a route is renamed. It also has a natural home: whoever next
touches `surfaces.ts` can fix all four rows in the same pass. Against that: the
failure mode is _silent and inverted_ (a broken lane reports success, which is
the one thing a gate must never do), and the cheap generalised guard above is
worth a ticket on its own if the lane is going to grow more surfaces.

**Deliberately not fixed in #2581.** Out of that issue's scope — the design
system slice touched `surfaces.ts` only to ADD the `design-system` and
`design-system-dialog` rows, and re-pointing the four pre-existing rows would
change what the lane measures in the same PR that changes what the pages look
like. It belongs to #2580's lane owner.
