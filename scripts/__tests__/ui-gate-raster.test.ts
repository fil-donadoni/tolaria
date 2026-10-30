import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import path from "node:path";
import { Window } from "happy-dom";
import {
    CARD_BLUR_MAX,
    blurredOf,
    describeRaster,
    type BlurExample,
} from "../ui-gate/raster.ts";
import {
    readingsOf,
    type AxeCount,
    type ProbeResult,
} from "../ui-gate/floors.ts";

/**
 * The rasterisation-level half of the `cardsSoft` Floor (issue #6940).
 *
 * The browser-side maths (`raster.js`) runs here in a happy-dom vm on
 * synthetic RGBA buffers — a canvas never exists in this environment, and the
 * screenshot/compare round trip is the lane's own business. What these tests
 * pin is the part a human reads: that the gradient energy orders a sharp
 * rendering above a blurred one of the same picture, that the Blur Index is
 * 0 for "as sharp as the resource" and 1 for "as soft as half resolution",
 * that the Floor counts exactly the samples over `CARD_BLUR_MAX`, and that the
 * cell line names a blurred face with the numbers behind it.
 */

const RASTER_SOURCE = readFileSync(
    path.join(__dirname, "../ui-gate/raster.js"),
    "utf8"
);

type RasterMath = {
    gradientEnergy: (
        data: Uint8ClampedArray | number[],
        w: number,
        h: number,
        inset: number
    ) => number;
    blurIndex: (shot: number, ref: number, half: number) => number | null;
};

function rasterMath(): RasterMath {
    const window = new Window({ url: "http://localhost/" });
    const context = createContext(window as unknown as object);
    runInContext(RASTER_SOURCE, context);
    return (window as unknown as { __tolariaRasterMath: RasterMath })
        .__tolariaRasterMath;
}

/** A w×h RGBA buffer of a vertical stripe pattern with period `period`: the
 *  sharp picture. */
function stripes(w: number, h: number, period: number): number[] {
    const data = new Array<number>(w * h * 4).fill(255);
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const v = Math.floor(x / period) % 2 ? 220 : 30;
            const i = (y * w + x) * 4;
            data[i] = v;
            data[i + 1] = v;
            data[i + 2] = v;
        }
    return data;
}

/** A w×h RGBA buffer of deterministic hashed noise: the fine detail of a
 *  printed face, which a blur merges and a step edge does not have. */
function texture(w: number, h: number): number[] {
    const data = new Array<number>(w * h * 4).fill(255);
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const v = 30 + (((x * 73 + y * 151 + x * y * 7) % 97) / 97) * 200;
            const i = (y * w + x) * 4;
            data[i] = v;
            data[i + 1] = v;
            data[i + 2] = v;
        }
    return data;
}

/** The same buffer box-blurred horizontally over `radius` pixels: the soft
 *  picture a lower-resolution raster of it looks like. */
function blurred(src: number[], w: number, h: number, radius: number) {
    const out = src.slice();
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            let sum = 0;
            let n = 0;
            for (let dx = -radius; dx <= radius; dx++) {
                const xx = Math.min(w - 1, Math.max(0, x + dx));
                sum += src[(y * w + xx) * 4];
                n++;
            }
            const i = (y * w + x) * 4;
            out[i] = out[i + 1] = out[i + 2] = sum / n;
        }
    return out;
}

describe("raster.js — gradient energy and the Blur Index", () => {
    const m = rasterMath();
    const W = 64;
    const H = 48;

    it("orders a sharp picture above a blurred rendering of the same picture", () => {
        const sharp = stripes(W, H, 4);
        const soft = blurred(sharp, W, H, 2);
        const es = m.gradientEnergy(sharp, W, H, 0.12);
        const eb = m.gradientEnergy(soft, W, H, 0.12);
        expect(es).toBeGreaterThan(0);
        expect(eb).toBeLessThan(es * 0.7);
    });

    it("ignores the inset border, where corners and rings live", () => {
        const flat = new Array<number>(W * H * 4).fill(128);
        // A hard edge along the left margin only.
        for (let y = 0; y < H; y++) {
            const i = (y * W + 2) * 4;
            flat[i] = flat[i + 1] = flat[i + 2] = 0;
        }
        expect(m.gradientEnergy(flat, W, H, 0.12)).toBe(0);
        expect(m.gradientEnergy(flat, W, H, 0)).toBeGreaterThan(0);
    });

    it("reads 0 for a screen as sharp as its resource, 1 for one as soft as half resolution, and interpolates between", () => {
        expect(m.blurIndex(10, 10, 5)).toBe(0);
        expect(m.blurIndex(5, 10, 5)).toBe(1);
        expect(m.blurIndex(7.5, 10, 5)).toBeCloseTo(0.5);
        // Sharper than the reference (a different resampler) clamps at 0,
        // never negative.
        expect(m.blurIndex(11, 10, 5)).toBe(0);
    });

    it("declines to judge a face whose half-resolution reference is indistinguishable from the full one", () => {
        expect(m.blurIndex(9.9, 10, 9.8)).toBeNull();
        expect(m.blurIndex(1, 0, 0)).toBeNull();
    });
});

const sample = (over: Partial<BlurExample>): BlurExample => ({
    t: "Brainstorm",
    sel: "img.w-full.h-full",
    x: 10,
    y: 20,
    w: 208,
    h: 291,
    dpr: 2,
    blur: 0.1,
    shot: 9,
    ref: 10,
    half: 5,
    src: "grid",
    dec: "208px",
    ...over,
});

describe("blurredOf — the samples the cardsSoft Floor counts", () => {
    it("counts exactly the samples over CARD_BLUR_MAX", () => {
        const samples = [
            sample({ blur: 0 }),
            sample({ blur: CARD_BLUR_MAX }),
            sample({ blur: CARD_BLUR_MAX + 0.01, t: "Counterspell" }),
            sample({ blur: 1.3, t: "Lightning Bolt" }),
        ];
        expect(blurredOf(samples).map((s) => s.t)).toEqual([
            "Counterspell",
            "Lightning Bolt",
        ]);
    });
});

describe("readingsOf — a blurred face is a soft face", () => {
    const probe: ProbeResult = {
        vp: "1440x900",
        cards: { n: 1, zero: 0, occ: 0, reachable: 1, stranded: 0 },
        cardsSquareN: 0,
        cardsSquare: [],
        cardsSoftN: 0,
        cardsSoft: [],
        cardsSoftPending: 0,
        cardsSoftUnknown: 0,
        ctrls: { n: 0, zero: 0, occ: 0, reachable: 0, stranded: 0 },
        starvedN: 0,
        starved: [],
        smallN: 0,
        shellBand: { mounted: false, excluded: 0 },
        tinyText: 0,
        hOverflow: 0,
        cardW: null,
        offenders: [],
    };
    const axe: AxeCount = {
        serious: 0,
        critical: 0,
        ids: [],
        exempt: 0,
        offenders: [],
    };

    it("adds the blurred samples to the resource-level count", () => {
        const withRaster = {
            ...probe,
            cardsSoftN: 2,
            raster: {
                samples: [sample({ blur: 0.9 }), sample({ blur: 0.2 })],
                skipped: [],
            },
        };
        expect(readingsOf(withRaster, axe).cardsSoft).toBe(3);
    });

    it("leaves the Floor untouched by a skipped (unmeasurable) face", () => {
        const skipped = {
            ...probe,
            raster: {
                samples: [],
                skipped: [{ t: "x", w: 40, why: "too small" }],
            },
        };
        expect(readingsOf(skipped, axe).cardsSoft).toBe(0);
    });

    it("reads the probe alone as before when no raster ran", () => {
        expect(readingsOf(probe, axe).cardsSoft).toBe(0);
    });
});

describe("describeRaster — the cell line", () => {
    it("names a blurred face with its slot, ratio, rendition and the three energies", () => {
        const line = describeRaster({
            samples: [sample({ blur: 0.87, shot: 6.1, ref: 10, half: 5.5 })],
            skipped: [],
        });
        expect(line).toContain("blur1[");
        expect(line).toContain("Brainstorm 208px@2x dec208px grid blur0.87");
        expect(line).toContain("shot6.1/ref10/half5.5");
        expect(line).toContain("rasterN1{208px@2x grid:0.87(s6.1/r10/h5.5)}");
    });

    it("prints blur0 and the per-sample indexes when nothing is blurred, and names a skip", () => {
        const line = describeRaster({
            samples: [sample({ blur: 0.05, w: 96 })],
            skipped: [{ t: "Island", w: 44, why: "too small" }],
        });
        expect(line).toContain(" blur0 ");
        expect(line).toContain("rasterN1{96px@2x grid:0.05(");
        expect(line).toContain("rasterSkip1[Island 44px: too small]");
    });
});

describe("raster.js — the candidate filters that keep a sharp face from reading as blurred", () => {
    type Filters = {
        fadedOrFiltered: (e: Element) => boolean;
        transformed: (
            e: { offsetWidth: number; offsetHeight: number },
            r: { width: number; height: number }
        ) => boolean;
    };
    function filters(bodyHtml: string): { f: Filters; doc: Document } {
        const window = new Window({ url: "http://localhost/" });
        const context = createContext(window as unknown as object);
        window.document.body.innerHTML = bodyHtml;
        runInContext(RASTER_SOURCE, context);
        return {
            f: (window as unknown as { __tolariaRasterMath: Filters })
                .__tolariaRasterMath,
            doc: window.document as unknown as Document,
        };
    }

    it("rejects a face whose ANCESTOR is translucent — the pending pick's opacity-60, the drag's opacity-30", () => {
        const { f, doc } = filters(
            `<div style="opacity: 0.6"><div><img id="a" src="x"></div></div>` +
                `<div style="opacity: 1"><img id="b" src="x"></div>`
        );
        expect(f.fadedOrFiltered(doc.getElementById("a")!)).toBe(true);
        expect(f.fadedOrFiltered(doc.getElementById("b")!)).toBe(false);
    });

    it("rejects a filtered face and keeps an unfiltered one", () => {
        const { f, doc } = filters(
            `<img id="a" src="x" style="filter: blur(2px)">` +
                `<img id="b" src="x" style="filter: none">`
        );
        expect(f.fadedOrFiltered(doc.getElementById("a")!)).toBe(true);
        expect(f.fadedOrFiltered(doc.getElementById("b")!)).toBe(false);
    });

    it("rejects a face whose screen box is not its layout box (a scaled or rotated ancestor), not a translated one", () => {
        const { f } = filters("");
        const layout = { offsetWidth: 100, offsetHeight: 140 };
        expect(f.transformed(layout, { width: 105, height: 147 })).toBe(true);
        expect(f.transformed(layout, { width: 140, height: 100 })).toBe(true);
        expect(f.transformed(layout, { width: 100.4, height: 140.6 })).toBe(
            false
        );
    });
});

describe("describeRaster — a cell with no sample says what its faces were", () => {
    it("prints the rejection census only when nothing was sampled", () => {
        const none = describeRaster({
            samples: [],
            skipped: [],
            rejected: { occluded: 12, faded: 1 },
            printed: 13,
        });
        expect(none).toContain(" rasterN0");
        expect(none).toContain("rasterRejected{occluded:12,faded:1} of 13");
        const some = describeRaster({
            samples: [sample({ blur: 0.01 })],
            skipped: [],
            rejected: { occluded: 12 },
            printed: 13,
        });
        expect(some).not.toContain("rasterRejected");
    });
});

describe("raster.js — normalised energy is contrast-free, and a uniform region is no picture", () => {
    type Norm = {
        normalizedEnergy: (
            data: number[],
            w: number,
            h: number,
            inset: number
        ) => number | null;
    };
    const m = (() => {
        const window = new Window({ url: "http://localhost/" });
        const context = createContext(window as unknown as object);
        runInContext(RASTER_SOURCE, context);
        return (window as unknown as { __tolariaRasterMath: Norm })
            .__tolariaRasterMath;
    })();
    const W = 64;
    const H = 48;

    it("does not move under an affine luminance map — a 60% scrim, a fade caught mid-way", () => {
        const sharp = stripes(W, H, 4);
        const faded = sharp.map((v, i) => (i % 4 === 3 ? v : v * 0.4 + 20));
        const a = m.normalizedEnergy(sharp, W, H, 0.12)!;
        const b = m.normalizedEnergy(faded, W, H, 0.12)!;
        expect(Math.abs(a - b) / a).toBeLessThan(0.02);
    });

    it("still orders a sharp picture above a blurred one", () => {
        // A TEXTURE, not clean stripes: the total variation of a step edge is
        // invariant under blur (the ramp sums to the same step), so only fine
        // detail that a blur merges — the rules text and frame hatching of a
        // card — can read as lost. Deterministic hashed noise is that detail.
        const sharp = texture(W, H);
        const soft = blurred(sharp, W, H, 2);
        expect(m.normalizedEnergy(soft, W, H, 0.12)!).toBeLessThan(
            m.normalizedEnergy(sharp, W, H, 0.12)! * 0.8
        );
    });

    it("reads a uniform region as null — blank, not sharp", () => {
        const flat = new Array<number>(W * H * 4).fill(90);
        expect(m.normalizedEnergy(flat, W, H, 0.12)).toBeNull();
    });
});

describe("raster.js — an inert overlay inside the face is masked out (issue #7590)", () => {
    type Masked = {
        normalizedEnergy: (
            data: number[],
            w: number,
            h: number,
            inset: number,
            mask?: Uint8Array | null
        ) => number | null;
        maskOf: (
            rects: number[][],
            w: number,
            h: number,
            pad: number
        ) => Uint8Array | null;
        maskedShare: (
            mask: Uint8Array | null,
            w: number,
            h: number,
            inset: number
        ) => number;
        blurIndex: (shot: number, ref: number, half: number) => number | null;
    };
    const m = (() => {
        const window = new Window({ url: "http://localhost/" });
        const context = createContext(window as unknown as object);
        runInContext(RASTER_SOURCE, context);
        return (window as unknown as { __tolariaRasterMath: Masked })
            .__tolariaRasterMath;
    })();
    const W = 96;
    const H = 128;
    /** The battlefield's P/T badge: a black box with white glyph strokes,
     *  pasted over the lower right of an otherwise identical face. */
    const BADGE = [0.45, 0.6, 0.85, 0.82];
    function withBadge(src: number[]): number[] {
        const out = src.slice();
        const [fx0, fy0, fx1, fy1] = BADGE;
        for (let y = Math.floor(fy0 * H); y < Math.ceil(fy1 * H); y++)
            for (let x = Math.floor(fx0 * W); x < Math.ceil(fx1 * W); x++) {
                const v = x % 9 < 2 ? 255 : 0;
                const i = (y * W + x) * 4;
                out[i] = out[i + 1] = out[i + 2] = v;
            }
        return out;
    }

    it("reads a badged face as sharp as its resource once the badge is masked — and as blurred without the mask", () => {
        const ref = texture(W, H);
        const half = blurred(ref, W, H, 2);
        const shot = withBadge(ref);
        const index = (mask: Uint8Array | null) =>
            m.blurIndex(
                m.normalizedEnergy(shot, W, H, 0.12, mask)!,
                m.normalizedEnergy(ref, W, H, 0.12, mask)!,
                m.normalizedEnergy(half, W, H, 0.12, mask)!
            )!;
        // The defect this mask removes: the badge alone reads as blur.
        expect(index(null)).toBeGreaterThan(0.5);
        expect(index(m.maskOf([BADGE], W, H, 1))).toBeLessThan(0.05);
    });

    it("measures the share of the inset region a mask covers", () => {
        expect(m.maskOf([], W, H, 0)).toBeNull();
        expect(m.maskedShare(null, W, H, 0.12)).toBe(0);
        const all = m.maskOf([[0, 0, 1, 1]], W, H, 0);
        expect(m.maskedShare(all, W, H, 0.12)).toBe(1);
        const badge = m.maskOf([BADGE], W, H, 0);
        const share = m.maskedShare(badge, W, H, 0.12);
        expect(share).toBeGreaterThan(0.1);
        expect(share).toBeLessThan(0.3);
    });
});

describe("blurredOf — a blank face counts whatever its index", () => {
    it("counts blank samples", () => {
        expect(
            blurredOf([sample({ blur: 0, blank: true }), sample({ blur: 0 })])
        ).toHaveLength(1);
    });
    it("names a blank face BLANK on the cell line", () => {
        expect(
            describeRaster({
                samples: [sample({ blur: 0, blank: true, shot: 0 })],
                skipped: [],
            })
        ).toContain("Brainstorm 208px@2x dec208px grid BLANK (shot0/");
    });
});
