// Area-average (box-filter) downscale of RGBA pixels (issue #8321).
//
// Every destination pixel is the exact mean of the source area it covers:
// no mip chain to land between levels of, no kernel to alias with. It is the
// "clean, high-quality downscale" the owner asked a 1x card face to look
// like, and it is ALSO the reference `check:ui`'s raster probe measures a
// face against (`scripts/ui-gate/raster.js` carries its own copy, kept in
// step by `src/lib/__tests__/boxDownscale.test.ts`): a face made here and
// drawn 1:1 reads as its own reference by construction, and what the probe
// still catches is everything the compositor does to it afterwards.
//
// WHY NOT THE BROWSER'S OWN RESIZER. `createImageBitmap(…, { resizeQuality:
// "high" })` read 0.88–0.99 of this filter's gradient energy in the headless
// shell and +42% to +91% ABOVE it in the full Chromium 151 (GPU-backed resize,
// bilinear, no prefilter) — measured on this lane 2026-11-07 on the deck
// builder's 107px, the draft pack's 86px and the Limited pool's 81px tiles.
// A resampler whose output depends on the renderer cannot be the fix for a
// defect that is the renderer's resampling. Pure JS is the same everywhere.
//
// Pure: no DOM, no canvas. Runs in the resample worker
// (`faceResample.worker.ts`) on buffers it pulled off an OffscreenCanvas.

/** The `object-fit: cover` source window of an `nw`×`nh` picture shown in a
 *  `w`×`h` box: `[sx, sy, sw, sh]` in source pixels, a centred crop. */
export function coverWindow(
    nw: number,
    nh: number,
    w: number,
    h: number
): [number, number, number, number] {
    const s = Math.max(w / nw, h / nh);
    const sw = w / s;
    const sh = h / s;
    return [(nw - sw) / 2, (nh - sh) / 2, sw, sh];
}

/**
 * The `[sx, sy, sw, sh]` window (fractional, in source pixels) of an
 * `srcW`×`srcH` RGBA buffer averaged into a `dw`×`dh` RGBA buffer, opaque.
 */
export function boxDownscale(
    src: Uint8ClampedArray,
    srcW: number,
    srcH: number,
    win: readonly [number, number, number, number],
    dw: number,
    dh: number
): Uint8ClampedArray {
    const [sx, sy, sw, sh] = win;
    const out = new Uint8ClampedArray(dw * dh * 4);
    const kx = sw / dw;
    const ky = sh / dh;
    for (let y = 0; y < dh; y++) {
        const y0 = sy + y * ky;
        const y1 = y0 + ky;
        const yy0 = Math.max(0, Math.floor(y0));
        const yy1 = Math.min(srcH, Math.ceil(y1));
        for (let x = 0; x < dw; x++) {
            const x0 = sx + x * kx;
            const x1 = x0 + kx;
            const xx0 = Math.max(0, Math.floor(x0));
            const xx1 = Math.min(srcW, Math.ceil(x1));
            let r = 0;
            let g = 0;
            let b = 0;
            let n = 0;
            for (let yy = yy0; yy < yy1; yy++) {
                const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
                if (wy <= 0) continue;
                for (let xx = xx0; xx < xx1; xx++) {
                    const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
                    if (wx <= 0) continue;
                    const wgt = wx * wy;
                    const i = (yy * srcW + xx) * 4;
                    r += src[i]! * wgt;
                    g += src[i + 1]! * wgt;
                    b += src[i + 2]! * wgt;
                    n += wgt;
                }
            }
            const o = (y * dw + x) * 4;
            out[o] = n ? r / n : 0;
            out[o + 1] = n ? g / n : 0;
            out[o + 2] = n ? b / n : 0;
            out[o + 3] = 255;
        }
    }
    return out;
}
