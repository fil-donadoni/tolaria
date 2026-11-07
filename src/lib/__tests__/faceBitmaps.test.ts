// The 1x face bitmap cache (issue #8321): reference-counted, LRU past its
// cap, failing open to `null`, and keyed by (art, device box).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    FACE_BITMAP_CACHE_MAX,
    FACE_BITMAP_MAX_DPR,
    acquireFaceBitmap,
    clearFaceBitmaps,
    faceBitmapCacheSize,
    faceBitmapKey,
    faceBitmapWanted,
    faceResamplePoolSize,
    resampleFace,
    type ResampleWorker,
} from "../faceBitmaps";
import { coverWindow } from "../boxDownscale";

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

    it("does not cache a failure: the next holder of the same key resamples again", async () => {
        const failing = vi.fn(async () => null);
        const a = acquireFaceBitmap(ART, 5, 7, failing);
        expect(await a.ready).toBeNull();
        expect(faceBitmapCacheSize()).toBe(0);
        const working = vi.fn(async () => "blob:test/retry");
        const b = acquireFaceBitmap(ART, 5, 7, working);
        expect(await b.ready).toBe("blob:test/retry");
        expect(working).toHaveBeenCalledTimes(1);
        a.release();
        b.release();
    });
});

/** A worker double: answers each request through `answer`, or not at all. */
function fakeWorker(
    answer: (req: {
        id: number;
        artUrl: string;
        w: number;
        h: number;
    }) => Blob | null | undefined
): ResampleWorker & { posted: number; terminated: boolean } {
    const w: ResampleWorker & { posted: number; terminated: boolean } = {
        posted: 0,
        terminated: false,
        onmessage: null,
        onerror: null,
        postMessage(req) {
            w.posted++;
            const blob = answer(req);
            if (blob === undefined) return; // never answers
            queueMicrotask(() =>
                w.onmessage?.({ data: { id: req.id, blob } } as MessageEvent)
            );
        },
        terminate() {
            w.terminated = true;
        },
    };
    return w;
}

describe("resampleFace — the worker round trip, failing open", () => {
    beforeEach(() => {
        clearFaceBitmaps();
        vi.stubGlobal("URL", {
            ...URL,
            createObjectURL: (b: Blob) => `blob:test/${b.size}`,
            revokeObjectURL: () => {},
        });
    });
    afterEach(() => {
        clearFaceBitmaps();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("posts the art and the device box, and hands back a URL for the worker's blob", async () => {
        const w = fakeWorker((req) => new Blob([`${req.w}x${req.h}`]));
        expect(await resampleFace(ART, 112, 157, () => w)).toBe("blob:test/7");
        expect(w.posted).toBe(1);
    });

    it("fills the pool, then reuses its members round-robin", async () => {
        const spawn = vi.fn(() => fakeWorker(() => new Blob(["x"])));
        const size = faceResamplePoolSize();
        for (let i = 0; i < size + 2; i++)
            await resampleFace(ART, i + 1, 1, spawn);
        expect(spawn).toHaveBeenCalledTimes(size);
        expect(faceResamplePoolSize(8)).toBe(3);
        expect(faceResamplePoolSize(2)).toBe(1);
        expect(faceResamplePoolSize(1)).toBe(1);
    });

    it("returns null when the worker answers null, and when it cannot be spawned", async () => {
        expect(
            await resampleFace(ART, 10, 14, () => fakeWorker(() => null))
        ).toBeNull();
        expect(
            await resampleFace(ART, 10, 14, () => {
                throw new Error("no Worker");
            })
        ).toBeNull();
    });

    it("gives up a request the worker never answers, and fails every request when the worker dies", async () => {
        vi.useFakeTimers();
        const silent = fakeWorker(() => undefined);
        const pending = resampleFace(ART, 10, 14, () => silent);
        await vi.advanceTimersByTimeAsync(13_000);
        expect(await pending).toBeNull();
        // A fresh worker for the next case: the silent one is still installed.
        clearFaceBitmaps();
        const dying = fakeWorker(() => undefined);
        const p1 = resampleFace(ART, 3, 4, () => dying);
        dying.onerror?.(new Event("error"));
        expect(await p1).toBeNull();
        expect(dying.terminated).toBe(true);
    });
});
