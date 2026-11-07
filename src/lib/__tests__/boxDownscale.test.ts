// The app's box filter (issue #8321) is the SAME algorithm `check:ui`'s
// raster probe builds its reference from (`scripts/ui-gate/raster.js`): a
// face made by one and measured by the other reads as its own reference. This
// file keeps the two copies in step on synthetic pixels, and pins the filter's
// defining property — every output pixel is the exact area mean.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import path from "node:path";
import { Window } from "happy-dom";
import { boxDownscale, coverWindow } from "../boxDownscale";

const RASTER_SOURCE = readFileSync(
    path.join(__dirname, "../../../scripts/ui-gate/raster.js"),
    "utf8"
);

type GateMath = {
    boxDownscale: (
        src: Uint8ClampedArray,
        sw: number,
        sh: number,
        win: readonly number[],
        dw: number,
        dh: number
    ) => Uint8ClampedArray;
    coverWindow: (nw: number, nh: number, W: number, H: number) => number[];
};

function gateMath(): GateMath {
    const window = new Window({ url: "http://localhost/" });
    const context = createContext(window as unknown as object);
    runInContext(RASTER_SOURCE, context);
    return (window as unknown as { __tolariaRasterMath: GateMath })
        .__tolariaRasterMath;
}

/** A deterministic RGBA texture with detail at every scale. */
function texture(w: number, h: number): Uint8ClampedArray {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            data[i] = (x * 37 + y * 11) % 256;
            data[i + 1] = (x * x + y * 3) % 256;
            data[i + 2] = (x * 5 + y * y) % 256;
            data[i + 3] = 255;
        }
    return data;
}

describe("boxDownscale — the exact area mean", () => {
    it("averages a 2×2 checker into one mid-grey pixel, never a sampled corner", () => {
        const checker = new Uint8ClampedArray([
            255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255,
        ]);
        const one = boxDownscale(checker, 2, 2, [0, 0, 2, 2], 1, 1);
        expect([...one.subarray(0, 4)]).toEqual([128, 128, 128, 255]);
    });

    it("weights a fractional window by coverage", () => {
        // 3 source px → 2 dest px: each dest covers 1.5 source px.
        const row = new Uint8ClampedArray([
            0, 0, 0, 255, 90, 90, 90, 255, 180, 180, 180, 255,
        ]);
        const two = boxDownscale(row, 3, 1, [0, 0, 3, 1], 2, 1);
        // (0×1 + 90×0.5)/1.5 = 30; (90×0.5 + 180×1)/1.5 = 150
        expect([two[0], two[4]]).toEqual([30, 150]);
    });
});

describe("the app's filter and the gate's reference are one algorithm", () => {
    const gate = gateMath();
    it("produce identical pixels for the same cover crop", () => {
        const src = texture(97, 136);
        const win = coverWindow(97, 136, 30, 42);
        expect(gate.coverWindow(97, 136, 30, 42)).toEqual([...win]);
        const app = boxDownscale(src, 97, 136, win, 30, 42);
        const ref = gate.boxDownscale(src, 97, 136, win, 30, 42);
        expect(app.length).toBe(ref.length);
        let maxDiff = 0;
        for (let i = 0; i < app.length; i++)
            maxDiff = Math.max(maxDiff, Math.abs(app[i]! - ref[i]!));
        expect(maxDiff).toBe(0);
    });
});
