# A 1x printed face is a box-filtered bitmap of its slot, and `check:ui` walks a DPR 1 desktop in the full Chromium

## Status

accepted (2026-11-07, issue #8321). Amends [ADR 0101][adr-0101] § 1 (the
Viewport Matrix) and [ADR 0132][adr-0132] § 1 (the `cardsSoft` Floor).

## Context

Three fixes shipped against "card art reads soft or grainy" (issues #3553,
#6940, #7590) and the owner still read grain on an external 1x monitor. Two
things had never been measured.

**Every viewport of the matrix is DPR 2 or 3.** The five emulated viewports
of ADR 0101 are Retina ones; a 1x display had never been walked.

**The raster probe could not disagree with its reference.** `raster.js`
(issue #6940) compared a face's screenshot against the same resource drawn by
the canvas at the same size. Measured on this lane (2026-11-07, three cards,
twelve slot widths, the probe's own maths on a synthetic page):

- In the **headless shell** `check:ui` walks in, an `<img>` is rastered by the
  very resampler the canvas reference uses: shot / reference read 1.00 for
  every rendition at every width, `will-change`, opacity and scale included.
  A probe that cannot see the renderer's resampling at all.
- In the **full Chromium** (headed and new-headless read the same numbers,
  which is the owner's desktop), the picture depends on where the slot falls
  on the resource's mip chain: `grid` (488px) in an 84px slot is its 122px mip
  bilinear-stepped by 0.69 and reads +35% gradient energy over the canvas
  reference; in a 64px, 128px or 256px slot a mip is upscaled and reads 0.84;
  `display` in a 64px slot reads +59%, in a 160px slot +68%; `thumb` at its
  own 146px reads 1.00 against itself and +41% against a clean downscale of
  the art — it is sharpened at source.
- The **canvas reference itself** wobbles ±10% around an area-average (box)
  filter from one width to the next, identically at every
  `imageSmoothingQuality`; `createImageBitmap(resizeQuality: "high")` reads
  0.88–0.99 of the box filter in the shell and +42% to +91% above it in the
  full Chromium.
- `grid` box-filtered reads within 3% of `display` box-filtered at every width
  up to 256px: the mid rendition is the clean art for any board slot.

The census on the real surfaces at DPR 1 in the full Chromium, against a
box-filtered `grid` reference (the run is on PR #8321's thread), confirmed the
class the owner reported: the choice dialog's 112px `grid` tiles read +55%
(alias) with their faded twins at 0.90 (soft); every `thumb` face (78–128px
slots, every deck and Limited surface) read +8% to +22%; the board's scaled
and promoted slots read 0.81–0.86 (soft). No face read clean except the few
whose width happened to sit on a mip level.

## The argument

1. **No CDN rendition is clean at every slot width, and the slots span 46 to
   256px.** A rendition table per width is a patchwork that moves with the
   next layout change; the issue's own measurement already overturned "lower
   the thumb threshold".
2. **The fix must be renderer-independent.** The defect IS the renderer's
   resampling; a fix that leans on another of its resamplers
   (`createImageBitmap`) was measured to be the same defect in the full
   browser.
3. **The clean downscale is a definition, not a setting.** An area-average is
   the exact mean of the source area each device pixel covers — nothing to
   alias with, nothing to land between. In pure JS it is the same everywhere,
   and the probe's reference can be the same algorithm.
4. **The check must be two-sided and measured where the defect shows.**
   Energy above the reference is grain, not sharpness. And a probe run only in
   a renderer that reads 1.00 by construction is a probe that proves nothing;
   the DPR 1 cells have to run where the owner's resampler runs.
5. **DPR 2 and 3 stay as they are.** The same mip stepping happens there in
   device pixels the eye does not resolve; the five viewports' receipts stay
   byte-identical, and the shell keeps walking them.

## Decision

### 1. A 1x printed face is a bitmap of its slot (`src/lib/faceBitmaps.ts`)

On a display under DPR 1.5, every `<img data-card-face="printed">` that goes
through the one printed-face source contract (`usePrintedFaceSource`: the
board card, the preview's printed panel, emblem and designation, library
order, pile division) draws a PNG the app made from the `grid` rendition —
decoded in a Worker, cropped as `object-fit: cover` crops it, area-averaged
(`src/lib/boxDownscale.ts`) to the slot's exact drawn device box — and draws
it 1:1. The face names its art in `data-art-src`.

- The box is the slot's LAYOUT box, exact — never the bounding rect (a
  dialog's `zoom-in-95`, a reflow spring, a `motion` FLIP) and never an
  ancestor's transform scale: an entrance animation gave a 64px face an 8px
  bitmap from its first frame, and a bitmap made at a promoted spatial slot's
  drawn size read SOFTER (0.69) than one at its layout size, the layer being
  rastered at scale 1 and composited down. A scaled board slot draws a
  layout-size bitmap through its scale — one compositor step, the residue
  below.
- Until the bitmap lands the element is on the page with its `alt`, the
  `data-face-pending` marker and a transparent SVG of the card's own aspect
  (488:680) as its source: the srcset would paint the frame this path exists
  to remove, and a 1×1 pixel re-shaped every content-sized slot (a hand card
  measured 120×167 became 120×120, re-keyed and made a square bitmap; a
  `height` attribute copied from the box fed the measurement back and grew a
  picker tile 5px a round). A lazy grid's face waits until its slot nears
  the viewport first.
- Entries are reference-counted and LRU-evicted past 400; a URL a mounted
  face shows is never revoked. Everything fails open to the srcset path.
- Displays at DPR ≥ 1.5 take the srcset path unchanged.

### 2. The Viewport Matrix has six viewports (amends ADR 0101 § 1)

`1440x900x1`, the desktop at DPR 1, joins the five. It differs in two
declared ways (`scripts/ui-gate/viewports.ts`):

- it walks only a surface that declares `cards` (it draws printed faces) —
  every other Floor is a function of CSS pixels and reads identically at DPR
  1 and 2;
- it runs in the FULL Chromium (`channel: "chromium"`), in a second browser
  instance beside the shell.

`evaluateRun`, the walk and the receipt re-derivation all read one rule
(`viewportWalks`): a surface without the flag owes the viewport no cell. A
`--viewport=` subset is `DIAGNOSTIC`, never a receipt.

### 3. The `cardsSoft` Floor's raster half is two-sided, against a box-filtered reference (amends ADR 0132 § 1)

`raster.js` builds its reference by area-averaging the `grid` rendition
(`display` past 488 device px) to the face's device box, in JS. Two indexes:

- **Blur Index** `(ref − shot) / (ref − half)`, red past 0.5 (unchanged);
- **Alias Index** `shot / ref − 1`, red past 0.15 — calibrated on the
  census: clean faces read at most +0.05 (the app's own bitmaps 0.96–1.05 of
  the reference; a `grid` face sitting on a mip level 0.98–1.01), the shell
  viewports' faces at most +0.08 (synthetic, 8 widths), the reported defect
  +0.55, `thumb` faces +0.08 to +0.22. The band +0.08…+0.15 holds the
  smallest `thumb` readings; those faces are removed by § 1, not caught by
  the check, and the residual is stated below.

A faded face is measured (the normalisation cancels an affine map; opacity
0.4 read identical to 1.0 to three decimals); a scaled face at its drawn box;
a quarter-turned face against a turned reference. Filtered or blended faces,
mid-tilt faces, faces whose own resource is narrower than their box, and
faces too small to tell half resolution from full are still skips, with the
number on the line.

### 4. What the census rejected

The standing `will-change: transform` on the spatial slot (issue #7590's
remaining promotion) was the issue's candidate cause. On the synthetic page a
promoted face read identical to a contained one at every width in both
renderers; on the real board the promoted, scaled faces read 0.81–0.86, the
same slot un-promoted 0.89 — the mip stepping, not the promotion. The
promotion stays; § 1 makes it moot (a 1:1 bitmap has nothing to re-raster).

## Consequences

- A `cards` surface owes a sixth cell. Measured on this lane: the DPR 1 pass
  over the 40 flagged surfaces walked in 726–993s on a machine at load 40–60,
  12–17s per cell; in a full run it rides in the pool beside the five.
- The five viewports' verdict blocks are unchanged; a PR touching a `cards`
  surface re-runs its scoped receipt once to gain the sixth row.
- The Draft Room and Deck Builder tiles go through `CardImage` and take § 1
  for free: their DPR 1 readings moved from +0.12/+0.15 (`thumb`) to 0.96–1.05.
  Raw `<img>` sites outside the contract (the drag ghost, the peek panel's
  40px thumb, the draft pile stack, the banlist tile, the 404 page) keep the
  srcset path; their readings are on the PR.
- Bytes at DPR 1: a face on the bitmap path fetches `grid` once (40–75 KB)
  where a ≤146 device px slot fetched `thumb` (~8 KB) — the 64px collapsed
  pile and the board's 86–120px slots — and the same `grid` everywhere else;
  the PNG lives in memory, not on the wire. The PR states the per-surface
  delta.
- Residual: a 1x face the contract does not reach, and a `thumb` face whose
  excess sits under +0.15, are not red. A spatial board slot scaled under 1
  (`placement.scale`) draws its layout-size bitmap through the compositor's
  scale: its reading is on the PR, and a bitmap at the drawn size was
  measured worse under the slot's standing promotion. The Alias threshold can tighten once
  the five shell viewports also walk in the full Chromium, which is a
  separate measurement (`docs/findings/`).

## Amendment (2026-11-09, issue #9009) — the Alias Index is judged under DPR 1.5 only

§ 3 judged the Alias Index at every viewport, but its 0.15 was calibrated at
DPR 1 in the full Chromium, and its "+0.08 at most" for the shell viewports
was a synthetic page's. On the real surfaces the base redded at 2x: `grid`
faces on deck-detail, pick-selectable-card and the dialogs read +0.30 to +0.39
over the box filter in the headless shell (`blur` 0.00, `soft` 0), so every
owed walk went red on cells its diff never touched; the same faces at 3x read
0.00–0.02. That contradicts § 5 (the five viewports' verdicts stay as they
were; their mip stepping lands in device pixels the eye does not resolve).

The Alias Index is therefore judged only below `CARD_ALIAS_DPR_MAX` = 1.5
(`scripts/ui-gate/raster.ts`), the same ratio that splits the bitmap path from
the srcset path (`FACE_BITMAP_MAX_DPR`). At 2x and 3x it is still measured and
printed on the cell line; the Blur Index, the blank check and the resource
half of `cardsSoft` are judged at every ratio. Calibrating an Alias threshold
for DPR 2 and 3 stays the separate measurement the Consequences name.

## Alternatives considered

- **A rendition table per slot width.** Measured: no rendition is clean at
  every width, and the clean widths are mip accidents.
- **`createImageBitmap` / canvas resize.** Measured: renderer-dependent, and
  the same defect in the full browser.
- **Walk every viewport in the full Chromium.** Changes the five viewports'
  readings from 1.00-by-construction to real ones, which would move verdicts
  the issue asked to keep; left to its own measurement.
- **Swap the srcset in first, the bitmap later.** Paints the grainy frame
  the path exists to remove.

[adr-0101]: 0101-design-system-v3-responsive-interaction.md
[adr-0132]: 0132-check-ui-is-an-invariant-gate-not-a-budget.md
