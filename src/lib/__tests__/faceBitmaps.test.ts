// The 1x face bitmap cache (issue #8321): reference-counted, LRU past its
// cap, failing open to `null`, and keyed by (art, device box).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    FACE_BITMAP_CACHE_MAX,
    FACE_BITMAP_MAX_DPR,
    acquireFaceBitmap,
    clearFaceBitmaps,
    coverWindow,
    faceBitmapCacheSize,
    faceBitmapKey,
    faceBitmapWanted,
    resampleFace,
} from "../faceBitmaps";

const ART = "https://cards.scryfall.io/grid/front/d/5/d573ef03.webp";

describe("faceBitmapWanted — the 1x gate", () => {
    it("takes the bitmap path under 1.5 and leaves every Retina ratio on the srcset", () => {
        expect(faceBitmapWanted(1)).toBe(true);
        expect(faceBitmapWanted(1.25)).toBe(true);
        expect(faceBitmapWanted(FACE_BITMAP_MAX_DPR)).toBe(false);
        expect(faceBitmapWanted(2)).toBe(false);
        expect(faceBitmapWanted(3)).toBe(false);
        expect(faceBitmapWanted(0)).toBe(false);
    });
});

describe("coverWindow — the object-fit: cover crop", () => {
    it("shows the whole art in a same-aspect box and crops a wider one", () => {
        const [sx, sy, sw, sh] = coverWindow(488, 680, 100, 140);
        expect(Math.round(sx)).toBe(1);
        expect(Math.round(sy)).toBe(0);
        expect(Math.round(sw)).toBe(486);
        expect(Math.round(sh)).toBe(680);
        const square = coverWindow(488, 680, 200, 200);
        expect(Math.round(square[1])).toBe(96);
        expect(Math.round(square[3])).toBe(488);
    });
});

describe("acquireFaceBitmap — the reference-counted cache", () => {
    const revoke = vi.fn();
    let urls = 0;
    beforeEach(() => {
        clearFaceBitmaps();
        urls = 0;
        revoke.mockClear();
        vi.stubGlobal("URL", {
            ...URL,
            createObjectURL: () => `blob:test/${++urls}`,
            revokeObjectURL: revoke,
        });
    });
    afterEach(() => {
        clearFaceBitmaps();
        vi.unstubAllGlobals();
    });
    const resample = vi.fn(async (art: string, w: number, h: number) =>
        URL.createObjectURL(new Blob([`${art}|${w}x${h}`]))
    );

    it("shares one bitmap across holders of the same (art, box) and makes it once", async () => {
        resample.mockClear();
        const a = acquireFaceBitmap(ART, 112, 157, resample);
        const b = acquireFaceBitmap(ART, 112, 157, resample);
        expect(await a.ready).toBe(await b.ready);
        expect(resample).toHaveBeenCalledTimes(1);
        expect(faceBitmapCacheSize()).toBe(1);
        expect(faceBitmapKey(ART, 112, 157)).toBe(`${ART}|112x157`);
    });

    it("makes a different bitmap for a different box", async () => {
        resample.mockClear();
        const a = acquireFaceBitmap(ART, 112, 157, resample);
        const b = acquireFaceBitmap(ART, 86, 120, resample);
        expect(await a.ready).not.toBe(await b.ready);
        expect(resample).toHaveBeenCalledTimes(2);
    });

    it("never revokes a URL a mounted face still holds; evicts released entries past the cap, oldest first", async () => {
        const held = acquireFaceBitmap(ART, 1, 1, resample);
        const heldUrl = await held.ready;
        const released: string[] = [];
        for (let i = 0; i < FACE_BITMAP_CACHE_MAX + 5; i++) {
            const h = acquireFaceBitmap(ART, 10 + i, 14, resample);
            released.push((await h.ready)!);
            h.release();
        }
        // Past the cap: the held entry stays, the oldest released ones went.
        expect(faceBitmapCacheSize()).toBe(FACE_BITMAP_CACHE_MAX);
        expect(revoke).not.toHaveBeenCalledWith(heldUrl);
        expect(revoke).toHaveBeenCalledWith(released[0]);
        // 406 entries, 400 kept: the six oldest released ones were revoked.
        expect(revoke).toHaveBeenCalledWith(released[5]);
        expect(revoke).not.toHaveBeenCalledWith(released[6]);
        expect(revoke).not.toHaveBeenCalledWith(released[released.length - 1]);
    });

    it("a release is idempotent and the entry survives until the last holder lets go", async () => {
        const a = acquireFaceBitmap(ART, 50, 70, resample);
        const b = acquireFaceBitmap(ART, 50, 70, resample);
        await a.ready;
        a.release();
        a.release();
        // Still held by `b`: filling the cache must not revoke it.
        for (let i = 0; i < FACE_BITMAP_CACHE_MAX + 1; i++) {
            acquireFaceBitmap(ART, 1000 + i, 1, resample).release();
        }
        expect(revoke).not.toHaveBeenCalledWith(await b.ready);
    });

    it("resolves null for a resample that failed, and the holders fall back", async () => {
        const failing = vi.fn(async () => null);
        const a = acquireFaceBitmap(ART, 5, 7, failing);
        expect(await a.ready).toBeNull();
    });
});

describe("resampleFace — fails open", () => {
    it("returns null on a non-OK fetch and on a fetch that throws", async () => {
        const notOk = (async () =>
            ({ ok: false }) as Response) as unknown as typeof fetch;
        expect(await resampleFace(ART, 10, 14, notOk)).toBeNull();
        const throwing = (async () => {
            throw new Error("offline");
        }) as unknown as typeof fetch;
        expect(await resampleFace(ART, 10, 14, throwing)).toBeNull();
    });
});
