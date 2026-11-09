/**
 * Rasterisation-level sharpness of printed card faces (issue #6940, two-sided
 * since issue #8321): the PURE half — the thresholds, the judgement and the
 * cell-line text. No browser, no filesystem: `floors.ts` (and through it
 * `receipt.ts`, `verify-receipt.ts`, the paths `land` re-derives a receipt
 * with) imports this module, so it must stay importable anywhere. The
 * Playwright side is `raster-measure.ts`; the in-page maths is `raster.js`.
 *
 * It is the half of the `cardsSoft` Floor `probe.js` cannot do: that probe
 * measures the RESOURCE the browser resolved; this measures the PIXELS the
 * compositor put on screen against a clean downscale of the art. `readingsOf`
 * (`floors.ts`) sums the two into the one Floor — a soft card face is a soft
 * card face, whichever stage lost the detail, and an aliased one is a defect
 * of the same Floor: grain is what the owner reads on a 1x display.
 */

/** The Blur Index past which a face is SOFT (see `raster.js`: 0 = as sharp as
 *  the clean reference, 1 = as soft as a half-resolution raster of it).
 *
 *  Measured on this lane (issue #6940, 2026-10-29), `draft-pick` and
 *  `limited-build` at all five viewports, headless and headed (GPU), at max
 *  zoom, after a hover: a sharp face reads 0.00–0.10, the margin being the
 *  compositor's bilinear downsample against the canvas's high-quality one;
 *  `half` reads 0.33–0.50 of `ref`, so a half-resolution raster would read
 *  ~1.0. A face whose promoted layer the compositor EVICTED under a starved
 *  GPU budget (`--force-gpu-mem-available-mb=24`) read 1.50 and 2.05 with a
 *  screenshot energy of 0 — a blank slot. 0.5 is the midpoint of a gap with
 *  nothing in it, not a tuned number.
 *
 *  Re-read against the box-filtered reference (issue #8321): the five shell
 *  viewports draw a face exactly as the old canvas reference did, which sits
 *  0.85–1.08 of the box filter, so their Blur Index moved to at most ~0.3
 *  (0.15 of `ref` over a 0.5 span) — under the threshold, unchanged verdicts.
 *  In the full Chromium at DPR 1, `grid` in a 64px, 128px or 256px slot (a
 *  mip level upscaled) read 0.84 of the canvas reference: Blur ~0.3, soft to
 *  the eye but not past this line; the Alias side below is what the 1x
 *  defect class reads on. */
export const CARD_BLUR_MAX = 0.5;

/** The Alias Index past which a face is ALIASED: `shot / ref − 1`, how much
 *  MORE gradient energy the screen has than the clean, box-filtered downscale
 *  of the art. Energy above the reference is not extra sharpness, it is
 *  grain — aliasing adds local contrast (issue #8321).
 *
 *  Calibrated on this lane (2026-11-07, `raster.js`'s maths on a synthetic
 *  page, full Chromium 151 headed and new-headless, three cards): the faces
 *  the owner reads as grainy — `thumb` drawn at its own 146px or at 112px
 *  (+21–45% over the box filter: sharpened at source), `grid` bilinear-stepped
 *  from its 122px mip into an 84px slot (+35–45%), `display` into a 64px slot
 *  (+59%) — read 0.21 and up; the clean cases (`grid` at 112px, 46px, 96px;
 *  the app's own box-filtered bitmap drawn 1:1) read −0.16 to +0.08; the
 *  shell viewports' faces, 0.85–1.08 of the box filter, at most +0.08. 0.15
 *  sits in the gap between +0.08 and +0.21 with a margin on both sides. */
export const CARD_ALIAS_MAX = 0.15;

/** The device pixel ratio at and above which the Alias Index is REPORTED but
 *  never judged (issue #9009): the same 1.5 that splits the app's bitmap path
 *  from the srcset path (`FACE_BITMAP_MAX_DPR`, `src/lib/faceBitmaps.ts`).
 *
 *  {@link CARD_ALIAS_MAX} was calibrated at DPR 1 in the full Chromium; it
 *  was never calibrated at DPR 2 or 3 (`docs/findings/8321-the-five-shell-
 *  viewports-cannot-see-the-renderers-resampling.md`), and ADR 0168 § 5
 *  keeps those viewports' verdicts as they were — their mip stepping lands in
 *  device pixels the eye does not resolve. Measured on the base (2026-11-09,
 *  headless shell): `grid` faces at 2x read +0.30 to +0.39 over the box
 *  filter on deck-detail, pick-selectable-card and the dialogs, which redded
 *  every owed walk on cells its diff never touched; the same faces at 3x read
 *  0.00–0.02. Over-reading the box filter at 2x is the shell's resampler, not
 *  the 1x grain the Alias side exists to catch. The Blur side (a soft or
 *  evicted layer) is judged at every ratio. */
export const CARD_ALIAS_DPR_MAX = 1.5;

/** Whether the Alias Index counts against the Floor at `dpr`. */
export function aliasJudgedAt(dpr: number): boolean {
    return dpr < CARD_ALIAS_DPR_MAX;
}

/** Whether a sample is grainier than {@link CARD_ALIAS_MAX} at a ratio where
 *  grain is judged ({@link aliasJudgedAt}). */
function isAliased(s: Pick<BlurExample, "alias" | "dpr">): boolean {
    return aliasJudgedAt(s.dpr) && s.alias > CARD_ALIAS_MAX;
}

/** One measured face, named so the run says WHICH card and by how much. `w`
 *  is the slot's CSS width, `dpr` the device pixel ratio it was shot at,
 *  `blur` the Blur Index, `alias` the Alias Index, `shot`/`ref`/`half` the
 *  three gradient energies behind them, `src` the rendition the browser held
 *  (`currentSrc`'s path segment; `bitmap` for an app-resampled face), `dec`
 *  the `sizes` hint the element declared. `faded`, `kind` and `promoted` are
 *  the census columns issue #8321 asked for: a face under an opacity, under a
 *  scale or a quarter turn, under a standing compositor promotion. */
export interface BlurExample {
    t: string;
    /** The face's short selector and viewport box, for the failure shot. */
    sel: string;
    x: number;
    y: number;
    h: number;
    w: number;
    dpr: number;
    blur: number;
    alias: number;
    shot: number;
    ref: number;
    half: number;
    src: string;
    dec: string;
    /** The screenshot was a UNIFORM region on every attempt — no picture at
     *  all where the face should be: an evicted layer, a blank slot. Counted
     *  as soft (the indexes are meaningless on a flat region). */
    blank?: boolean;
    faded?: boolean;
    kind?: "none" | "scaled" | "rotated";
    promoted?: boolean;
}

/** A picked face that could not be measured, and why. */
export interface RasterSkip {
    t: string;
    w: number;
    why: string;
}

export interface RasterResult {
    /** Every face that produced an index. */
    samples: BlurExample[];
    /** Picked faces whose comparison could not run or was declined: the
     *  reference image did not load (CORS, network, timeout), the screenshot
     *  failed, the source changed between pick and shot, the resource is
     *  narrower than the face (the resource check's class), or the face is
     *  too small for the half-resolution reference to differ from the full
     *  one. REPORTED, never gated: the lane's `cardsSoft` resource check
     *  still stands on such a face, and a third-party CDN's availability is
     *  not a property of the tree. */
    skipped: RasterSkip[];
    /** Printed faces on the page that were never picked, by reason
     *  (`occluded`, `filtered`, `hidden`, `transformed`, `offscreen`,
     *  `small`, `unresolved`) — so a cell that yields no sample says what its
     *  faces were instead of reading as a vacuous pass. */
    rejected?: Record<string, number>;
    /** Printed faces on the page, decorative art excluded. */
    printed?: number;
}

/** Whether one sample counts against the Floor: blank, softer than
 *  {@link CARD_BLUR_MAX}, or grainier than {@link CARD_ALIAS_MAX} under
 *  {@link CARD_ALIAS_DPR_MAX}. */
export function isSoft(
    s: Pick<BlurExample, "blank" | "blur" | "alias" | "dpr">
): boolean {
    return s.blank === true || s.blur > CARD_BLUR_MAX || isAliased(s);
}

/** The faces whose indexes exceed the thresholds: the reading the `cardsSoft`
 *  Floor counts. Pure, for the unit test. */
export function blurredOf(samples: readonly BlurExample[]): BlurExample[] {
    return samples.filter(isSoft);
}

/** How a sample's defect reads on the cell line and the failure shot. */
export function softWhy(s: BlurExample): string {
    if (s.blank) return "BLANK";
    const parts: string[] = [];
    if (s.blur > CARD_BLUR_MAX) parts.push(`blur${s.blur.toFixed(2)}`);
    if (isAliased(s)) parts.push(`alias${s.alias.toFixed(2)}`);
    return parts.join("+");
}

/** The census flags of one sample, as a short suffix: `f` faded, `s` scaled,
 *  `r` rotated, `p` promoted ancestor. Empty for a plain face. */
function flagsOf(s: BlurExample): string {
    const f =
        (s.faded ? "f" : "") +
        (s.kind === "scaled" ? "s" : s.kind === "rotated" ? "r" : "") +
        (s.promoted ? "p" : "");
    return f ? `[${f}]` : "";
}

/** The diagnostic fragment of one cell line: every sample with its two
 *  indexes and the three energies, the skips, and — when nothing was sampled
 *  — what the page's printed faces were rejected as. */
export function describeRaster(r: RasterResult): string {
    const blurred = blurredOf(r.samples);
    const head = blurred.length
        ? ` blur${blurred.length}[` +
          blurred
              .map(
                  (s) =>
                      `${s.t} ${s.w}px@${s.dpr}x${flagsOf(s)} dec${s.dec} ${s.src} ${softWhy(s)} (shot${s.shot}/ref${s.ref}/half${s.half})`
              )
              .join("; ") +
          "]"
        : ` blur0`;
    const tail = r.samples.length
        ? ` rasterN${r.samples.length}{` +
          r.samples
              .map(
                  (s) =>
                      `${s.w}px@${s.dpr}x${flagsOf(s)} ${s.src}:${s.blank ? "BLANK" : `${s.blur.toFixed(2)}/${s.alias.toFixed(2)}`}(s${s.shot}/r${s.ref}/h${s.half})`
              )
              .join(",") +
          "}"
        : ` rasterN0`;
    const skip = r.skipped.length
        ? ` rasterSkip${r.skipped.length}[` +
          r.skipped.map((s) => `${s.t} ${s.w}px: ${s.why}`).join("; ") +
          "]"
        : "";
    const rejectedEntries = Object.entries(r.rejected ?? {});
    const rejected =
        rejectedEntries.length && !r.samples.length
            ? ` rasterRejected{` +
              rejectedEntries.map(([why, n]) => `${why}:${n}`).join(",") +
              `}` +
              (r.printed !== undefined ? ` of ${r.printed}` : "")
            : "";
    return head + tail + skip + rejected;
}
