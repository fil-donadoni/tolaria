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
import {
    CARD_BLUR_MAX,
    type BlurExample,
    type RasterResult,
    type RasterSkip,
} from "./raster.ts";

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
    blank?: boolean;
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

/** Shots per face before a soft or blank reading is believed, and the pause
 *  between them. Three attempts 400 ms apart bound a worst-case face at
 *  under two seconds plus its shots. */
export const RASTER_ATTEMPTS = 3;
export const RASTER_RETRY_MS = 400;

/** A reading that would count against the Floor as it stands. */
function suspect(cmp: Comparison | null): boolean {
    if (!cmp) return true;
    if (cmp.blank) return true;
    return typeof cmp.blur === "number" && cmp.blur > CARD_BLUR_MAX;
}

/** `a` is a better (sharper, more complete) reading than `b`. A blank is worse
 *  than any number; an unjudgeable face (`blur` null) is neutral. */
function betterThan(a: Comparison, b: Comparison | null): boolean {
    if (!b) return true;
    if (b.blank) return !a.blank;
    if (a.blank) return false;
    const ab = typeof a.blur === "number" ? a.blur : Infinity;
    const bb = typeof b.blur === "number" ? b.blur : Infinity;
    return ab < bb;
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
    /** One shot-and-compare of a marked face. */
    const attempt = async (
        c: Candidate
    ): Promise<{ cmp: Comparison } | { skip: string }> => {
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
            return { skip: `screenshot failed: ${first}` };
        }
        const cmp = await page.evaluate(
            (spec) =>
                (globalThis as unknown as RasterPage).__tolariaRasterCompare(
                    spec
                ),
            { k: c.k, png64, src: c.src }
        );
        if (cmp.error || cmp.skip) return { skip: cmp.error ?? cmp.skip! };
        return { cmp };
    };
    try {
        for (const c of candidates.picked) {
            // CONFIRM BEFORE RED. A face read soft or blank once is shot again
            // after a pause, up to RASTER_ATTEMPTS times, and the BEST reading
            // stands: a frame caught mid-paint, a fade still running, a layer
            // not yet rastered all clear on the retry, while an evicted layer
            // or a genuinely soft raster reads the same every time. Measured
            // on this lane: a transient read 1.06 on one run and 0.00 on the
            // next; the evicted layers of the starved-budget experiment read
            // blank on every attempt.
            let best: Comparison | null = null;
            let skip: string | null = null;
            for (let i = 0; i < RASTER_ATTEMPTS; i++) {
                if (i > 0) await page.waitForTimeout(RASTER_RETRY_MS);
                const r = await attempt(c);
                if ("skip" in r) {
                    skip = r.skip;
                    break;
                }
                if (betterThan(r.cmp, best)) best = r.cmp;
                if (!suspect(best)) break;
            }
            if (skip !== null && best === null) {
                skipped.push({ t: c.t, w: c.w, why: skip });
                continue;
            }
            if (!best) continue;
            if (
                !best.blank &&
                (best.blur === null || best.blur === undefined)
            ) {
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
                blur: best.blank ? 0 : +best.blur!.toFixed(3),
                ...(best.blank ? { blank: true } : {}),
                shot: best.shot ?? 0,
                ref: best.ref ?? 0,
                half: best.half ?? 0,
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
