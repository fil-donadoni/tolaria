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
// fetches) is decoded in a Worker (`faceResample.worker.ts`), cropped the way
// `object-fit: cover` crops it, and AREA-AVERAGED (`boxDownscale.ts`) to the
// slot's exact device size — the alias-free downscale, in pure JS so it is
// the same in every renderer (the browser's own `createImageBitmap` resize
// read +42% to +91% over it in the full Chromium; see `boxDownscale.ts`). The
// result comes back as a PNG blob and is handed to the `<img>` as a `blob:`
// URL, which it then draws 1:1 — nothing left for the compositor to
// resample. The face names the art it was made from in `data-art-src`,
// which `check:ui`'s raster probe builds its reference from and its resource
// check reads the width against.
//
// COST, and why a cache. A 112×157 face is 70 KB raw and ~30 KB as PNG; the
// board holds ~50 faces, a library browse 60, the search grid hundreds (which
// is why a lazy grid opts out). Entries are reference-counted: a mounted
// face holds its entry, and only unreferenced entries past the cap are
// evicted (oldest first) and their URLs revoked — a URL an `<img>` still
// shows is never revoked under it. The Worker is one, spawned on first use.
//
// FAIL OPEN, to the srcset path. No `Worker`, no `OffscreenCanvas`, a CORS or
// network failure, a worker that died or never answered within the timeout:
// the entry resolves `null` and the caller renders the responsive srcset
// exactly as before. Nothing here can leave a slot blank.
import type {
    FaceResampleReply,
    FaceResampleRequest,
} from "./faceResample.worker";

/** Displays at or above this ratio draw the srcset path unchanged; below it
 *  the face is resampled to its slot. 1.5 splits 1x from every Retina ratio
 *  and leaves a zoomed-in 1x browser (DPR 1.25) on the resampled path. */
export const FACE_BITMAP_MAX_DPR = 1.5;

/** Unreferenced entries past this many are evicted, oldest first. */
export const FACE_BITMAP_CACHE_MAX = 400;

/** A resample that has not answered by then is given up (the face falls
 *  back to the srcset); a stalled CDN must never hold a slot empty. */
export const FACE_RESAMPLE_TIMEOUT_MS = 12_000;

/** Workers in the pool: a face costs a decode, a filter and a PNG encode
 *  (~100 ms on a loaded machine), and a pile dialog opens on sixty of them
 *  at once — one worker took them in series and a choice dialog still had
 *  faces pending at the 30 s settle mark (measured on this lane). Three
 *  workers, capped by the cores past the UI thread. */
export const FACE_RESAMPLE_POOL_MAX = 3;

/** The pool size for this machine. */
export function faceResamplePoolSize(
    hardwareConcurrency: number = navigator?.hardwareConcurrency ?? 4
): number {
    return Math.max(
        1,
        Math.min(FACE_RESAMPLE_POOL_MAX, hardwareConcurrency - 1)
    );
}

export interface FaceBitmapHandle {
    /** The `blob:` URL once resampled; `null` when the resample failed (the
     *  caller falls back to the srcset). */
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
        typeof Worker === "function" &&
        typeof OffscreenCanvas !== "undefined" &&
        typeof createImageBitmap === "function" &&
        typeof URL !== "undefined" &&
        typeof URL.createObjectURL === "function"
    );
}

/** Whether a display at `dpr` takes the bitmap path. */
export function faceBitmapWanted(dpr: number): boolean {
    return dpr > 0 && dpr < FACE_BITMAP_MAX_DPR;
}

/** The slice of a Worker this module uses — injectable for the unit test. */
export interface ResampleWorker {
    postMessage(message: FaceResampleRequest): void;
    onmessage: ((e: MessageEvent<FaceResampleReply>) => void) | null;
    onerror: ((e: unknown) => void) | null;
    terminate(): void;
}

function spawnWorker(): ResampleWorker {
    return new Worker(new URL("./faceResample.worker.ts", import.meta.url), {
        type: "module",
    }) as unknown as ResampleWorker;
}

interface PoolMember {
    worker: ResampleWorker;
    inflight: Map<number, (blob: Blob | null) => void>;
}

const pool: PoolMember[] = [];
let nextId = 1;
let nextMember = 0;

/** A dead member's requests fail open, and the next request spawns anew. */
function dropMember(member: PoolMember): void {
    const at = pool.indexOf(member);
    if (at >= 0) pool.splice(at, 1);
    try {
        member.worker.terminate();
    } catch {
        // already gone
    }
    for (const resolve of member.inflight.values()) resolve(null);
    member.inflight.clear();
}

/** Every member of the pool, dropped — the test's reset. */
function dropPool(): void {
    for (const member of [...pool]) dropMember(member);
}

/** The next member round-robin, spawning until the pool is full. */
function getMember(spawn: () => ResampleWorker): PoolMember {
    if (pool.length < faceResamplePoolSize()) {
        const member: PoolMember = { worker: spawn(), inflight: new Map() };
        member.worker.onmessage = (e) => {
            const resolve = member.inflight.get(e.data.id);
            if (!resolve) return;
            member.inflight.delete(e.data.id);
            resolve(e.data.blob);
        };
        member.worker.onerror = () => dropMember(member);
        pool.push(member);
        return member;
    }
    nextMember = (nextMember + 1) % pool.length;
    return pool[nextMember]!;
}

/** Fetches the art and resamples it to `w`×`h` device pixels in the worker;
 *  `null` on any failure or after {@link FACE_RESAMPLE_TIMEOUT_MS}. */
export async function resampleFace(
    artUrl: string,
    w: number,
    h: number,
    spawn: () => ResampleWorker = spawnWorker
): Promise<string | null> {
    let member: PoolMember;
    try {
        member = getMember(spawn);
    } catch {
        return null;
    }
    const id = nextId++;
    const blob = await new Promise<Blob | null>((resolve) => {
        const timer = setTimeout(() => {
            if (member.inflight.delete(id)) resolve(null);
        }, FACE_RESAMPLE_TIMEOUT_MS);
        member.inflight.set(id, (b) => {
            clearTimeout(timer);
            resolve(b);
        });
        try {
            member.worker.postMessage({ id, artUrl, w, h });
        } catch {
            clearTimeout(timer);
            member.inflight.delete(id);
            resolve(null);
        }
    });
    if (!blob) return null;
    try {
        return URL.createObjectURL(blob);
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
            if (url === null) {
                // A failed resample (network, CORS, timeout, a dead worker)
                // is not cached: the next face to mount at this key tries
                // again, instead of inheriting the failure until eviction —
                // which a mounted holder prevents.
                entries.delete(key);
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

/** Drops every entry, revokes every URL and forgets the worker — for the
 *  unit test. */
export function clearFaceBitmaps(): void {
    for (const e of entries.values()) if (e.url) URL.revokeObjectURL(e.url);
    entries.clear();
    dropPool();
}
