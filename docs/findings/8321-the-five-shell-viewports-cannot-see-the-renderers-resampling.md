---
title: The five DPR 2/3 viewports walk in the headless shell, whose image resampler is the raster probe's own reference — their rasterisation readings are 1.00 by construction
discoveredBy: 8321
status: draft
confidence: high
---

**What is wrong.** `check:ui`'s raster probe (`scripts/ui-gate/raster.js`,
issue #6940) compares a face's screenshot against a reference drawn from the
same art. In the headless shell Playwright launches by default, an `<img>` is
rastered by the same resampler the in-page canvas uses: measured on the issue
#8321 pass (2026-11-07, three cards, twelve slot widths, every rendition,
contained / `will-change` / opacity / scale), shot over reference read 1.000 ±
0.03 everywhere. The full Chromium (`channel: "chromium"`, headed and
new-headless alike) read 0.83–1.68 across the same grid. So the five DPR 2/3
cells of every receipt since issue #6940 have measured the shell's own
resampler against itself; what they CAN still see is a layer rastered at a
different scale than it is shown at (issue #7590's class), and a blank
(evicted) layer.

**Evidence.** `scripts/ui-gate/viewports.ts` (ADR 0168) carries the two
numbers; the synthetic harness lives in the pass's `$RUNNER_TEMP` and is
reproducible from `raster.js`'s exported maths in any Playwright context.

**Why it may not deserve its own issue.** Moving the five viewports to the
full Chromium changes their readings from 1.00-by-construction to real ones,
and real ones at DPR 2 include mip stepping the eye does not resolve (`grid`
in an 84px CSS slot at 2x read +32% on the synthetic page). Issue #8321 asked
for DPR 2/3 to stay unchanged. The move needs its own calibration pass — the
Alias threshold (`CARD_ALIAS_MAX`) at DPR 2 and 3, on the real surfaces — and
a decision on whether a 2x face that over-reads by a third is a defect at all.
