/**
 * Rasterisation-level sharpness of printed card faces (issue #6940): the Node
 * half of `raster.js`. Picks the faces, screenshots each by locator (device
 * pixels, transitions finished), hands the PNG to the page for the canvas
 * comparison, and judges the Blur Indexes against one constant.
 *
 * It is the half of the `cardsSoft` Floor `probe.js` cannot do: that probe
 * measures the RESOURCE the browser resolved; this measures the PIXELS the
 * compositor put on screen against that same resource. `readingsOf`
 * (`floors.ts`) sums the two into the one Floor — a soft card face is a soft
 * card face, whichever stage lost the detail.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RASTER_SOURCE = fs.readFileSync(path.join(HERE, "raster.js"), "utf8");

/** Faces measured per cell: one per distinct layout width, largest first, so
 *  a surface's size classes are each seen once. Four element screenshots and
 *  compares cost well under a second — the whole measurement rides inside
 *  the cell's `probe` phase. */
export const RASTER_SAMPLES_PER_CELL = 4;

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

/** A face that could not be measured, and why (`k` is its mark). */
export interface RasterSkip {
    t: string;
    w: number;
    why: string;
}

export interface RasterResult {
    /** Every face that produced a Blur Index. */
    samples: BlurExample[];
    /** Faces whose comparison could not run: the reference image did not
     *  load (CORS, network), the screenshot failed, or the face is too small
     *  for the half-resolution reference to differ from the full one.
     *  REPORTED, never gated: the lane's `cardsSoft` resource check still
     *  stands on such a face, and a third-party CDN's availability is not a
     *  property of the tree. */
    skipped: RasterSkip[];
}

interface Candidate {
    k: number;
    sel: string;
    t: string;
    w: number;
    x: number;
    y: number;
    h: number;
    src: string;
    dec: string;
    dpr: number;
}

interface Comparison {
    shot?: number;
    ref?: number;
    half?: number;
    blur?: number | null;
    error?: string;
}

function renditionOf(src: string): string {
    // `https://cards.scryfall.io/<variant>/<face>/<a>/<b>/<id>.<ext>`
    return src.split("/")[3] ?? src;
}

/** The faces whose Blur Index exceeds {@link CARD_BLUR_MAX}: the reading the
 *  `cardsSoft` Floor counts. Pure, for the unit test. */
export function blurredOf(samples: readonly BlurExample[]): BlurExample[] {
    return samples.filter((s) => s.blur > CARD_BLUR_MAX);
}

/** The diagnostic fragment of one cell line: every sample with its Blur
 *  Index, or the count when there is nothing to say. */
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
    return head + tail + skip;
}

/**
 * Measures up to {@link RASTER_SAMPLES_PER_CELL} printed faces on the current
 * page. Never throws for a face that cannot be measured — it lands in
 * `skipped` with its reason — but does propagate a page that navigated away,
 * which the caller already treats as a cell to retry.
 */
export async function measureRaster(page: Page): Promise<RasterResult> {
    await page.addScriptTag({ content: RASTER_SOURCE });
    const candidates = (await page.evaluate(
        `window.__tolariaRasterCandidates(${RASTER_SAMPLES_PER_CELL})`
    )) as Candidate[];
    const samples: BlurExample[] = [];
    const skipped: RasterSkip[] = [];
    try {
        for (const c of candidates) {
            let png64: string;
            try {
                // The element's own box in DEVICE pixels; `animations:
                // "disabled"` finishes a hover translate or a transition the
                // walk may have started, so the frame compared is a settled
                // one, never a mid-transition raster.
                const buf = await page
                    .locator(`[data-ui-gate-raster="${c.k}"]`)
                    .screenshot({
                        type: "png",
                        animations: "disabled",
                        caret: "hide",
                        scale: "device",
                        timeout: 5_000,
                    });
                png64 = buf.toString("base64");
            } catch (err) {
                skipped.push({
                    t: c.t,
                    w: c.w,
                    why: `screenshot failed: ${(err as Error).message.split("\n")[0]}`,
                });
                continue;
            }
            const cmp = (await page.evaluate(
                `window.__tolariaRasterCompare(${JSON.stringify({ k: c.k, png64, src: c.src })})`
            )) as Comparison;
            if (cmp.error) {
                skipped.push({ t: c.t, w: c.w, why: cmp.error });
                continue;
            }
            if (cmp.blur === null || cmp.blur === undefined) {
                skipped.push({
                    t: c.t,
                    w: c.w,
                    why: "too small to tell half-resolution from full",
                });
                continue;
            }
            samples.push({
                t: c.t,
                sel: c.sel,
                x: c.x,
                y: c.y,
                h: c.h,
                w: c.w,
                dpr: c.dpr,
                blur: +cmp.blur.toFixed(3),
                shot: cmp.shot ?? 0,
                ref: cmp.ref ?? 0,
                half: cmp.half ?? 0,
                src: renditionOf(c.src),
                dec: c.dec,
            });
        }
    } finally {
        await page.evaluate("window.__tolariaRasterClear()").catch(() => {});
    }
    return { samples, skipped };
}
