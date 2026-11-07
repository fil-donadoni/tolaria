// Device-size bitmaps of printed card faces for 1x displays (issue #8321).
//
// WHY. On a DPR 1 display every board slot is a few dozen to a couple of
// hundred device pixels wide, and the browser has to step a 146/488/672px
// rendition down to it. Chrome does that through the resource's mip chain —
// nearest power-of-two level, then bilinear — so what the slot shows depends
// on where its width falls between two levels: `grid` in an 84px slot is its
// 122px mip bilinear-stepped by 0.69 (+35% gradient energy over a clean
// downscale: grain), in a 64px slot its 61px mip upscaled (−16%: soft), and
// `thumb` is sharpened at source (+21% at 112px). Measured on this lane
// (2026-11-07, full Chromium 151, headed and headless, three cards) — no
// rendition is clean at every slot width, and the slots this app draws span
// 46 to 256px. At DPR 2 and 3 the same stepping happens in device pixels the
// eye does not resolve, and the five Retina viewports read clean; so this
// path is for 1x only.
//
// WHAT. The art (`grid`, the rendition every slot under 488 device px already
// fetches) is decoded once, cropped the way `object-fit: cover` crops it, and
// resized OFF the main thread to the slot's exact device size with the
// browser's high-quality resampler (`createImageBitmap`'s `resizeQuality:
// "high"` — measured 0.88–0.99 of a box filter's gradient energy at every
// width, never above it). The result is encoded to a PNG blob and handed to
// the `<img>` as a `blob:` URL, which it then draws 1:1 — nothing left for the
// compositor to resample. The face names the art it was made from in
// `data-art-src`, which `check:ui`'s raster probe builds its reference from
// and its resource check reads the width against.
//
// COST, and why a cache. A 112×157 face is 70 KB raw and ~30 KB as PNG; the
// board holds ~50 faces, a library browse 60, the search grid hundreds (which
// is why a lazy grid opts out). Entries are reference-counted: a mounted
// face holds its entry, and only unreferenced entries past the cap are
// evicted (oldest first) and their URLs revoked — a URL an `<img>` still
// shows is never revoked under it.
//
// FAIL OPEN, to the srcset path. No `createImageBitmap`, no `OffscreenCanvas`,
// a CORS or network failure, a resampler that ignored the resize request
// (older engines): the entry resolves `null` and the caller renders the
// responsive srcset exactly as before. Nothing here can leave a slot blank.

/** Displays at or above this ratio draw the srcset path unchanged; below it
 *  the face is resampled to its slot. 1.5 splits 1x from every Retina ratio
 *  and leaves a zoomed-in 1x browser (DPR 1.25) on the resampled path. */
export const FACE_BITMAP_MAX_DPR = 1.5;

/** Unreferenced entries past this many are evicted, oldest first. */
export const FACE_BITMAP_CACHE_MAX = 400;

export interface FaceBitmapHandle {
    /** The `blob:` URL once resampled; `null` while pending or when the
     *  resample failed (the caller falls back to the srcset). */
    ready: Promise<string | null>;
    /** The mounted face no longer shows this bitmap. */
    release: () => void;
}

interface Entry {
    url: string | null;
    ready: Promise<string | null>;
    refs: number;
    /** Monotonic touch counter — the eviction order. */
    touched: number;
}

const entries = new Map<string, Entry>();
let clock = 0;

/** The cache key: one bitmap per (art, device width, device height). */
export function faceBitmapKey(artUrl: string, w: number, h: number): string {
    return `${artUrl}|${w}x${h}`;
}

/** Whether this engine can make the bitmap at all. */
export function supportsFaceBitmaps(): boolean {
    return (
        typeof createImageBitmap === "function" &&
        typeof OffscreenCanvas !== "undefined" &&
        typeof URL !== "undefined" &&
        typeof URL.createObjectURL === "function" &&
        typeof fetch === "function"
    );
}

/** Whether a display at `dpr` takes the bitmap path. */
export function faceBitmapWanted(dpr: number): boolean {
    return dpr > 0 && dpr < FACE_BITMAP_MAX_DPR;
}

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

/** Fetches the art and resamples it to `w`×`h` device pixels; `null` on any
 *  failure. Exported for the unit test, which injects `fetch`. */
export async function resampleFace(
    artUrl: string,
    w: number,
    h: number,
    fetchImpl: typeof fetch = fetch
): Promise<string | null> {
    try {
        const res = await fetchImpl(artUrl, {
            mode: "cors",
            credentials: "omit",
        });
        if (!res.ok) return null;
        const blob = await res.blob();
        const full = await createImageBitmap(blob);
        try {
            const [sx, sy, sw, sh] = coverWindow(full.width, full.height, w, h);
            const bitmap = await createImageBitmap(full, sx, sy, sw, sh, {
                resizeWidth: w,
                resizeHeight: h,
                resizeQuality: "high",
            });
            try {
                // An engine that ignored the resize request would hand back
                // the crop at source size; drawing that into the small canvas
                // would be the compositor's own resample again. Fail open.
                if (bitmap.width !== w || bitmap.height !== h) return null;
                const canvas = new OffscreenCanvas(w, h);
                const ctx = canvas.getContext("2d");
                if (!ctx) return null;
                ctx.drawImage(bitmap, 0, 0);
                const out = await canvas.convertToBlob({ type: "image/png" });
                return URL.createObjectURL(out);
            } finally {
                bitmap.close();
            }
        } finally {
            full.close();
        }
    } catch {
        return null;
    }
}

function evict() {
    if (entries.size <= FACE_BITMAP_CACHE_MAX) return;
    const idle = [...entries.entries()]
        .filter(([, e]) => e.refs === 0)
        .sort((a, b) => a[1].touched - b[1].touched);
    for (const [key, entry] of idle) {
        if (entries.size <= FACE_BITMAP_CACHE_MAX) break;
        entries.delete(key);
        if (entry.url) URL.revokeObjectURL(entry.url);
    }
}

/**
 * A face's bitmap at `w`×`h` device pixels, shared across every mounted face
 * showing the same art at the same size. The handle's `release` MUST be
 * called when the face unmounts or changes size; the entry stays cached
 * (and its URL valid) while any holder remains.
 */
export function acquireFaceBitmap(
    artUrl: string,
    w: number,
    h: number,
    resample: (
        artUrl: string,
        w: number,
        h: number
    ) => Promise<string | null> = resampleFace
): FaceBitmapHandle {
    const key = faceBitmapKey(artUrl, w, h);
    let entry = entries.get(key);
    if (!entry) {
        const created: Entry = {
            url: null,
            ready: Promise.resolve(null),
            refs: 0,
            touched: ++clock,
        };
        created.ready = resample(artUrl, w, h).then((url) => {
            // An entry evicted (or never stored) while its resample ran
            // would leak its URL: revoke it unless this is still the entry.
            if (entries.get(key) !== created) {
                if (url) URL.revokeObjectURL(url);
                return null;
            }
            created.url = url;
            return url;
        });
        entries.set(key, created);
        entry = created;
        evict();
    }
    entry.refs++;
    entry.touched = ++clock;
    let released = false;
    return {
        ready: entry.ready,
        release: () => {
            if (released) return;
            released = true;
            entry.refs = Math.max(0, entry.refs - 1);
            entry.touched = ++clock;
        },
    };
}

/** The cache's live size — for the unit test. */
export function faceBitmapCacheSize(): number {
    return entries.size;
}

/** Drops every entry and revokes every URL — for the unit test. */
export function clearFaceBitmaps(): void {
    for (const e of entries.values()) if (e.url) URL.revokeObjectURL(e.url);
    entries.clear();
}
