---
title: /admin/design-system carries an axe CRITICAL (`label`) that nothing was measuring
discoveredBy: 2581
status: draft
confidence: medium
---

**What is wrong.** The design-system census page was outside `bun run check:ui`
until #2581 added it as a surface. The first measurement found **1 axe critical
(`label`)** and 1-2 serious (`color-contrast`, plus
`scrollable-region-focusable` at `390x844x3`) at every viewport. `axeCritical 0`
is one of the lane's three hard floors (`scripts/ui-gate/budgets.json` note), and
this is the only surface in the lane breaking it.

**Evidence.** `bun run check:ui -- --surface=design-system`:

```
design-system 1440x900x2  ... axe s1/c1 (label,color-contrast)
design-system 390x844x3   ... axe s2/c1 (label,color-contrast,scrollable-region-focusable)
```

Measured twice, once with the new §14 v3 section rendered and once with it
removed (`{false && <V3Sections />}`): the counts and rule ids are IDENTICAL, so
none of it comes from the section #2581 added. `label` is almost certainly an
input specimen in §09 Inputs (`src/routes/design-system/sections-inputs-chips.tsx`)
rendered without an associated `<label>`; `color-contrast` is at least partly
deliberate — §01 renders failing ratios ON PURPOSE, in red, as the census of what
fails.

**Why it may not deserve its own issue.** Two of the three findings are arguably
the page doing its job: a census of a design system has to be able to show a
failing swatch, and a bare `<input>` specimen is what an input specimen IS. The
honest fix is probably narrow — give the input specimens visually-hidden labels
so the page's own a11y is clean and the deliberate contrast failures are the only
remainder — but deciding that is a judgment about what a reference page owes,
which is exactly the call the drawer exists to leave to a human. If the answer is
"specimens get labels", it is a ten-line change and a budget re-record, not a
ticket.
