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
        expect(line).toContain("rasterN1{208px:0.87}");
    });

    it("prints blur0 and the per-sample indexes when nothing is blurred, and names a skip", () => {
        const line = describeRaster({
            samples: [sample({ blur: 0.05, w: 96 })],
            skipped: [{ t: "Island", w: 44, why: "too small" }],
        });
        expect(line).toContain(" blur0 ");
        expect(line).toContain("rasterN1{96px:0.05}");
        expect(line).toContain("rasterSkip1[Island 44px: too small]");
    });
});
