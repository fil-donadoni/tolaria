---
title: The card-choice prompt does not settle at DPR 1 while its faces take the bitmap path — "a measured box kept moving", no face pending, no console error
discoveredBy: 8321
status: draft
confidence: medium
---

**What is wrong.** `check:ui --viewport=1440x900x1 --surface=game-choice-prompt`
(full Chromium, ADR 0168) reads `unsettled … a measured box kept moving` for
the whole 30 s window, three attempts, at load 6–10, on every run of the
issue #8321 pass (2026-11-07, five runs). The same walk at `1440x900x2` in the
shell settles in 23 s and passes every Floor. With `FACE_BITMAP_MAX_DPR`
set to 0 (every face on the srcset path) the DPR 1 cell settles in 37 s and
the raster probe reads the defect the issue reports — `Grizzly Bears 112px
grid alias 0.55 (shot 0.833 / ref 0.537)` — so the two-sided check sees the
class; it is the bitmap path on this one surface that keeps a measured box
moving. `game-zone-pile` (the same `CardsPile` grid, not a picker) settles at
DPR 1 on the bitmap path and reads `112px bitmap 0.44/0.00`.

**Ruled out on the pass.** A pending face (the settle names them: zero in
the final runs); the 1×1 placeholder re-shaping a content-sized slot and a
`height` attribute feeding the measurement back (both fixed in
`usePrintedFaceSource`, PR #8321's thread has the mount census: tiles growing
157 → 162 → 167 …); machine load (reproduced at load 6).

**Candidates not yet measured.** `CardImageLoader` under a tile whose
`loaded` never turns true; the picker-only tile state (`pickerRingClass`,
dimmed ineligible tiles); a sub-pixel row-height change when a 488:680
rendition is replaced by a 112×157 bitmap inside the `game-dialog-column`
settle target. The settle verdict does not name the moving box; a run with
`settle.ts` printing the box's selector and its two sizes is the next step.

**Why it is not an issue yet.** The surface is not flagged `cards`, so the
lane owes it no DPR 1 cell and nothing is red; the owner's browser takes the
bitmap path on that dialog regardless of the lane. It needs one attributed
run before it is a ticket.
