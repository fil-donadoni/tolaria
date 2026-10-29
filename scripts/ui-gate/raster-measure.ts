/**
 * Rasterisation-level sharpness of printed card faces (issue #6940): the
 * Playwright half. Injects `raster.js`, picks the faces, screenshots each by
 * locator (device pixels, transitions finished), hands the PNG to the page for
 * the canvas comparison, and returns the samples and skips `raster.ts` judges.
 *
 * Kept apart from `raster.ts` so the pure module (which `floors.ts` and the
 * receipt re-derivation import) never touches the filesystem or Playwright.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import type { BlurExample, RasterResult, RasterSkip } from "./raster.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RASTER_PATH = path.join(HERE, "raster.js");
let rasterSource: string | null = null;

/** Faces measured per cell: one per distinct layout width, largest first, so
 *  a surface's size classes are each seen once. Four element screenshots and
 *  compares cost about a second — the measurement rides inside the cell's
 *  `probe` phase, bounded by the per-shot and per-load timeouts below. */
export const RASTER_SAMPLES_PER_CELL = 4;

/** An error that means the page went away under the measurement: rethrown so
 *  the cell's retry loop (which already treats a navigation during the probe
 *  as a retry, not a verdict) sees it, instead of a silently unmeasured face. */
const PAGE_GONE = /Execution context was destroyed|navigat|Target .*closed/i;

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

interface Candidates {
    picked: Candidate[];
    rejected: Record<string, number>;
    printed: number;
}

interface Comparison {
    shot?: number;
    ref?: number;
    half?: number;
    blur?: number | null;
    skip?: string;
    error?: string;
}

/** What `raster.js` installs on the page. The scripts project has no DOM lib
 *  (deliberately), so the page global is typed here and reached through
 *  `globalThis` inside the functions `page.evaluate` ships to the browser. */
interface RasterPage {
    __tolariaRasterCandidates: (max: number) => Candidates;
    __tolariaRasterCompare: (spec: {
        k: number;
        png64: string;
        src: string;
    }) => Promise<Comparison>;
    __tolariaRasterClear: () => void;
}

function renditionOf(src: string): string {
    // `https://cards.scryfall.io/<variant>/<face>/<a>/<b>/<id>.<ext>`
    return src.split("/")[3] ?? src;
}

/**
 * Measures up to {@link RASTER_SAMPLES_PER_CELL} printed faces on the current
 * page. A face that cannot be measured lands in `skipped` with its reason; a
 * page that navigated away under the measurement is rethrown for the caller's
 * retry loop.
 */
export async function measureRaster(page: Page): Promise<RasterResult> {
    rasterSource ??= fs.readFileSync(RASTER_PATH, "utf8");
    await page.addScriptTag({ content: rasterSource });
    const candidates = await page.evaluate(
        (max) =>
            (globalThis as unknown as RasterPage).__tolariaRasterCandidates(
                max
            ),
        RASTER_SAMPLES_PER_CELL
    );
    const samples: BlurExample[] = [];
    const skipped: RasterSkip[] = [];
    try {
        for (const c of candidates.picked) {
            let png64: string;
            try {
                // The element's own box in DEVICE pixels. `animations:
                // "disabled"` finishes a hover translate or a transition the
                // walk may have started, so the frame compared is a settled
                // one, never a mid-transition raster; the offender box keeps
                // the pre-shot coordinates, which a 2px lift does not move
                // out of its outline.
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
                const first = (err as Error).message.split("\n")[0];
                if (PAGE_GONE.test(first)) throw err;
                skipped.push({
                    t: c.t,
                    w: c.w,
                    why: `screenshot failed: ${first}`,
                });
                continue;
            }
            const cmp = await page.evaluate(
                (spec) =>
                    (
                        globalThis as unknown as RasterPage
                    ).__tolariaRasterCompare(spec),
                { k: c.k, png64, src: c.src }
            );
            if (cmp.error || cmp.skip) {
                skipped.push({ t: c.t, w: c.w, why: cmp.error ?? cmp.skip! });
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
        await page
            .evaluate(() =>
                (globalThis as unknown as RasterPage).__tolariaRasterClear()
            )
            .catch(() => {});
    }
    return {
        samples,
        skipped,
        rejected: candidates.rejected,
        printed: candidates.printed,
    };
}
