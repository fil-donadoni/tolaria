/**
 * Rasterisation-level sharpness of printed card faces (issue #6940): the PURE
 * half — the threshold, the judgement and the cell-line text. No browser, no
 * filesystem: `floors.ts` (and through it `receipt.ts`, `verify-receipt.ts`,
 * the paths `land` re-derives a receipt with) imports this module, so it must
 * stay importable anywhere. The Playwright side is `raster-measure.ts`; the
 * in-page maths is `raster.js`.
 *
 * It is the half of the `cardsSoft` Floor `probe.js` cannot do: that probe
 * measures the RESOURCE the browser resolved; this measures the PIXELS the
 * compositor put on screen against that same resource. `readingsOf`
 * (`floors.ts`) sums the two into the one Floor — a soft card face is a soft
 * card face, whichever stage lost the detail.
 */

/** The Blur Index past which a face is SOFT (see `raster.js`: 0 = as sharp as
 *  its resource allows, 1 = as soft as a half-resolution raster of it).
 *
 *  Measured on this lane (issue #6940, 2026-10-29), `draft-pick` and
 *  `limited-build` at all five viewports, headless and headed (GPU), at max
 *  zoom, after a hover: a sharp face reads 0.00–0.10, the margin being the
 *  compositor's bilinear downsample against the canvas's high-quality one;
 *  `half` reads 0.33–0.50 of `ref`, so a half-resolution raster would read
 *  ~1.0. A face whose promoted layer the compositor EVICTED under a starved
 *  GPU budget (`--force-gpu-mem-available-mb=24`) read 1.50 and 2.05 with a
 *  screenshot energy of 0 — a blank slot. 0.5 is the midpoint of a gap with
 *  nothing in it, not a tuned number. */
export const CARD_BLUR_MAX = 0.5;

/** One measured face, named so the run says WHICH card and by how much. `w`
 *  is the slot's CSS width, `dpr` the device pixel ratio it was shot at,
 *  `blur` the Blur Index, `shot`/`ref`/`half` the three gradient energies
 *  behind it, `src` the rendition the browser held (`currentSrc`'s path
 *  segment), `dec` the `sizes` hint the element declared. */
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
    shot: number;
    ref: number;
    half: number;
    src: string;
    dec: string;
}

/** A picked face that could not be measured, and why. */
export interface RasterSkip {
    t: string;
    w: number;
    why: string;
}

export interface RasterResult {
    /** Every face that produced a Blur Index. */
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
     *  (`occluded`, `faded`, `transformed`, `offscreen`, `small`,
     *  `unresolved`) — so a cell that yields no sample says what its faces
     *  were instead of reading as a vacuous pass. */
    rejected?: Record<string, number>;
    /** Printed faces on the page, decorative art excluded. */
    printed?: number;
}

/** The faces whose Blur Index exceeds {@link CARD_BLUR_MAX}: the reading the
 *  `cardsSoft` Floor counts. Pure, for the unit test. */
export function blurredOf(samples: readonly BlurExample[]): BlurExample[] {
    return samples.filter((s) => s.blur > CARD_BLUR_MAX);
}

/** The diagnostic fragment of one cell line: every sample with its Blur
 *  Index and the three energies, the skips, and — when nothing was sampled —
 *  what the page's printed faces were rejected as. */
export function describeRaster(r: RasterResult): string {
    const blurred = blurredOf(r.samples);
    const head = blurred.length
        ? ` blur${blurred.length}[` +
          blurred
              .map(
                  (s) =>
                      `${s.t} ${s.w}px@${s.dpr}x dec${s.dec} ${s.src} blur${s.blur.toFixed(2)} (shot${s.shot}/ref${s.ref}/half${s.half})`
              )
              .join("; ") +
          "]"
        : ` blur0`;
    const tail = r.samples.length
        ? ` rasterN${r.samples.length}{` +
          r.samples
              .map(
                  (s) =>
                      `${s.w}px@${s.dpr}x ${s.src}:${s.blur.toFixed(2)}(s${s.shot}/r${s.ref}/h${s.half})`
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
