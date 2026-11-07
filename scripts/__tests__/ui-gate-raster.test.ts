import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import path from "node:path";
import { Window } from "happy-dom";
import {
    CARD_ALIAS_MAX,
    CARD_BLUR_MAX,
    blurredOf,
    describeRaster,
    softWhy,
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
    alias: 0,
    shot: 9,
    ref: 10,
    half: 5,
    src: "grid",
    dec: "208px",
    ...over,
});

describe("blurredOf — the samples the cardsSoft Floor counts", () => {
    it("counts the samples over CARD_ALIAS_MAX — energy above the reference is grain, not sharpness (issue #8321)", () => {
        const samples = [
            sample({ alias: 0 }),
            sample({ alias: CARD_ALIAS_MAX }),
            sample({ alias: CARD_ALIAS_MAX + 0.01, t: "Island" }),
            sample({ alias: 0.45, t: "Lightning Bolt" }),
        ];
        expect(blurredOf(samples).map((s) => s.t)).toEqual([
            "Island",
            "Lightning Bolt",
        ]);
        expect(softWhy(sample({ alias: 0.45, blur: 0 }))).toBe("alias0.45");
        expect(softWhy(sample({ alias: 0, blur: 0.8 }))).toBe("blur0.80");
        expect(softWhy(sample({ blank: true }))).toBe("BLANK");
    });

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
        expect(line).toContain(
            "rasterN1{208px@2x grid:0.87/0.00(s6.1/r10/h5.5)}"
        );
    });

    it("carries the census flags — faded, scaled or rotated, promoted — on each sample (issue #8321)", () => {
        const line = describeRaster({
            samples: [
                sample({ faded: true, promoted: true, w: 112 }),
                sample({ kind: "rotated", w: 64, alias: 0.3 }),
            ],
            skipped: [],
        });
        expect(line).toContain("112px@2x[fp] grid:0.10/0.00(");
        expect(line).toContain("64px@2x[r] grid:0.10/0.30(");
        expect(line).toContain("Brainstorm 64px@2x[r] dec208px grid alias0.30");
    });

    it("prints blur0 and the per-sample indexes when nothing is blurred, and names a skip", () => {
        const line = describeRaster({
            samples: [sample({ blur: 0.05, w: 96 })],
            skipped: [{ t: "Island", w: 44, why: "too small" }],
        });
        expect(line).toContain(" blur0 ");
        expect(line).toContain("rasterN1{96px@2x grid:0.05/0.00(");
        expect(line).toContain("rasterSkip1[Island 44px: too small]");
    });
});

describe("raster.js — the candidate filters, and what is measured rather than skipped (issue #8321)", () => {
    type Filters = {
        filteredOrBlended: (e: Element) => boolean;
        compositedOpacity: (e: Element) => number;
        transformKind: (
            e: { offsetWidth: number; offsetHeight: number },
            r: { width: number; height: number }
        ) => "none" | "scaled" | "rotated" | "other";
        promotedAncestor: (e: Element) => boolean;
        renditionOf: (url: string) => string | null;
        referenceSourceOf: (e: Element, deviceW: number) => string | null;
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

    it("reads a face's composited opacity down to the root — a faded face is measured, not skipped", () => {
        const { f, doc } = filters(
            `<div style="opacity: 0.6"><div style="opacity: 0.5"><img id="a" src="x"></div></div>` +
                `<div style="opacity: 1"><img id="b" src="x"></div>`
        );
        expect(f.compositedOpacity(doc.getElementById("a")!)).toBeCloseTo(0.3);
        expect(f.compositedOpacity(doc.getElementById("b")!)).toBe(1);
    });

    it("rejects a filtered or blended face and keeps an unfiltered one", () => {
        const { f, doc } = filters(
            `<img id="a" src="x" style="filter: blur(2px)">` +
                `<div style="mix-blend-mode: multiply"><img id="c" src="x"></div>` +
                `<img id="b" src="x" style="filter: none">`
        );
        expect(f.filteredOrBlended(doc.getElementById("a")!)).toBe(true);
        expect(f.filteredOrBlended(doc.getElementById("c")!)).toBe(true);
        expect(f.filteredOrBlended(doc.getElementById("b")!)).toBe(false);
    });

    it("classes a face's on-screen box: translated is none, a uniform scale is scaled, a quarter turn is rotated, a tilt is other", () => {
        const { f } = filters("");
        const layout = { offsetWidth: 100, offsetHeight: 140 };
        expect(f.transformKind(layout, { width: 100.4, height: 140.6 })).toBe(
            "none"
        );
        expect(f.transformKind(layout, { width: 105, height: 147 })).toBe(
            "scaled"
        );
        expect(f.transformKind(layout, { width: 140, height: 100 })).toBe(
            "rotated"
        );
        expect(f.transformKind(layout, { width: 126, height: 90 })).toBe(
            "rotated"
        );
        expect(f.transformKind(layout, { width: 120, height: 150 })).toBe(
            "other"
        );
    });

    it("reports a standing compositor promotion above the face — will-change or a 3D transform on an ancestor", () => {
        const { f, doc } = filters(
            `<div style="will-change: transform"><div><img id="a" src="x"></div></div>` +
                `<div style="transform: translateZ(0)"><img id="c" src="x"></div>` +
                `<div style="transform: translate(3px, 4px)"><img id="b" src="x"></div>`
        );
        expect(f.promotedAncestor(doc.getElementById("a")!)).toBe(true);
        expect(f.promotedAncestor(doc.getElementById("c")!)).toBe(true);
        expect(f.promotedAncestor(doc.getElementById("b")!)).toBe(false);
    });

    it("builds the reference from the clean rendition of the SAME art — grid, or display past grid's width — and from data-art-src for a bitmap face", () => {
        const { f, doc } = filters(
            `<img id="a" src="https://cards.scryfall.io/thumb/front/d/5/d573ef03.webp">` +
                `<img id="b" src="blob:http://localhost/abc" data-art-src="https://cards.scryfall.io/grid/front/d/5/d573ef03.webp">` +
                `<img id="c" src="blob:http://localhost/def">`
        );
        expect(f.referenceSourceOf(doc.getElementById("a")!, 112)).toBe(
            "https://cards.scryfall.io/grid/front/d/5/d573ef03.webp"
        );
        expect(f.referenceSourceOf(doc.getElementById("a")!, 600)).toBe(
            "https://cards.scryfall.io/display/front/d/5/d573ef03.webp"
        );
        expect(f.referenceSourceOf(doc.getElementById("b")!, 112)).toBe(
            "https://cards.scryfall.io/grid/front/d/5/d573ef03.webp"
        );
        expect(f.referenceSourceOf(doc.getElementById("c")!, 112)).toBeNull();
        expect(f.renditionOf("blob:http://localhost/abc")).toBe("bitmap");
        expect(
            f.renditionOf("https://cards.scryfall.io/thumb/front/d/5/x.webp")
        ).toBe("thumb");
    });
});

describe("raster.js — the two-sided index and the box-filtered reference (issue #8321)", () => {
    type Math2 = {
        aliasIndex: (shot: number, ref: number) => number | null;
        boxDownscale: (
            src: number[] | Uint8ClampedArray,
            sw: number,
            sh: number,
            win: number[],
            dw: number,
            dh: number
        ) => Uint8ClampedArray;
        upscale2x: (
            src: Uint8ClampedArray,
            w: number,
            h: number
        ) => Uint8ClampedArray;
        rotate90: (
            src: number[] | Uint8ClampedArray,
            w: number,
            h: number
        ) => Uint8ClampedArray;
        coverWindow: (nw: number, nh: number, W: number, H: number) => number[];
        gradientEnergy: (
            data: number[] | Uint8ClampedArray,
            w: number,
            h: number,
            inset: number
        ) => number;
    };
    const m = (() => {
        const window = new Window({ url: "http://localhost/" });
        const context = createContext(window as unknown as object);
        runInContext(RASTER_SOURCE, context);
        return (window as unknown as { __tolariaRasterMath: Math2 })
            .__tolariaRasterMath;
    })();

    it("reads 0 at or below the reference and the excess fraction above it", () => {
        expect(m.aliasIndex(10, 10)).toBe(0);
        expect(m.aliasIndex(8, 10)).toBe(0);
        expect(m.aliasIndex(13.5, 10)).toBeCloseTo(0.35);
        expect(m.aliasIndex(5, 0)).toBeNull();
    });

    it("box-downscales to the exact area mean — a 2×2 checker becomes one mid-grey pixel, never a sampled corner", () => {
        const checker = [
            255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255,
        ];
        const one = m.boxDownscale(checker, 2, 2, [0, 0, 2, 2], 1, 1);
        expect([...one.subarray(0, 3)]).toEqual([128, 128, 128]);
        // A 4×2 stripe pair averaged into 2×1: each column pair its own mean.
        const stripes4 = [
            200, 200, 200, 255, 100, 100, 100, 255, 0, 0, 0, 255, 50, 50, 50,
            255, 200, 200, 200, 255, 100, 100, 100, 255, 0, 0, 0, 255, 50, 50,
            50, 255,
        ];
        const two = m.boxDownscale(stripes4, 4, 2, [0, 0, 4, 2], 2, 1);
        expect([two[0], two[4]]).toEqual([150, 25]);
    });

    it("a quarter turn swaps the buffer's sides and keeps its gradient energy", () => {
        const sharp = stripes(40, 28, 4);
        const turned = m.rotate90(sharp, 40, 28);
        expect(turned.length).toBe(40 * 28 * 4);
        const e0 = m.gradientEnergy(sharp, 40, 28, 0);
        const e1 = m.gradientEnergy(turned, 28, 40, 0);
        expect(e1).toBeGreaterThan(e0 * 0.9);
        expect(e1).toBeLessThan(e0 * 1.1);
    });

    it("upscales 2× bilinearly and centres the cover crop", () => {
        const small = m.boxDownscale(
            stripes(8, 8, 2),
            8,
            8,
            [0, 0, 8, 8],
            4,
            4
        );
        expect(m.upscale2x(small, 4, 4).length).toBe(8 * 8 * 4);
        // A 488×680 art into a 100×140 box: near-same aspect, a 1px trim.
        expect(m.coverWindow(488, 680, 100, 140).map(Math.round)).toEqual([
            1, 0, 486, 680,
        ]);
        // A wider box crops the top and bottom.
        const [sx, sy, sw, sh] = m.coverWindow(488, 680, 200, 200);
        expect(Math.round(sx)).toBe(0);
        expect(Math.round(sw)).toBe(488);
        expect(Math.round(sh)).toBe(488);
        expect(Math.round(sy)).toBe(96);
    });
});

describe("describeRaster — a cell with no sample says what its faces were", () => {
    it("prints the rejection census only when nothing was sampled", () => {
        const none = describeRaster({
            samples: [],
            skipped: [],
            rejected: { occluded: 12, filtered: 1 },
            printed: 13,
        });
        expect(none).toContain(" rasterN0");
        expect(none).toContain("rasterRejected{occluded:12,filtered:1} of 13");
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
