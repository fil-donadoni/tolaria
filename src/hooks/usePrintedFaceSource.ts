import { useEffect, useState } from "react";
import { useNearViewport } from "./useNearViewport";
import {
    getImageFallbackUrl,
    getImageSrcSet,
    getImageUrl,
    type CardImageFace,
} from "~/lib/images";
import {
    FACE_RESAMPLE_TIMEOUT_MS,
    acquireFaceBitmap,
    faceBitmapKey,
    supportsFaceBitmaps,
} from "~/lib/faceBitmaps";
import useCardSlotFloor, { type CardSlotBox } from "./useCardSlotFloor";

/** The attributes a printed-face `<img>` spreads: the responsive srcset, the
 *  jpg fallback, the 1x bitmap with the art it was made from — or, while
 *  that bitmap is being made, NO source and the pending marker: the element
 *  is on the page (its `alt` names the button around it for a screen reader
 *  and for axe's `button-name`; `check:ui`'s settle waits on the marker) but
 *  paints nothing until the one source it will show is ready. */
export type PrintedFaceAttrs =
    | { src: string; srcSet: string; sizes: string }
    | { src: string }
    | { src: string; "data-art-src": string }
    | {
          src: typeof PENDING_FACE_SRC;
          /** `""` while the bitmap is being made; `"deferred"` while a lazy
           *  face waits to near the viewport — nothing is in flight, and
           *  `check:ui`'s settle must not wait on it (an off-screen grid
           *  tile never nears without a scroll). */
          "data-face-pending": "" | "deferred";
      };

/** The source a pending face shows: a transparent SVG with the CARD's
 *  intrinsic size (every Scryfall front rendition is 488:680), so the element
 *  is a replaced box of its CSS size (an `<img>` with no `src` lays out as
 *  its alt text and moved the tiles around it — measured on this lane as a
 *  choice dialog that never settled) and paints nothing. The aspect is not
 *  a nicety: a content-sized slot — the hand card, the picker tile — takes
 *  its height from the image's intrinsic ratio, and a 1×1 pixel there turned
 *  a 120×167 hand card into a 120×120 one, re-measured, re-keyed and made a
 *  square bitmap; a `height` attribute copied from the measured box fed the
 *  measurement back into itself and grew the tile 5px a round (the DPR 1
 *  census of issue #8321: "a measured box kept moving"). The placeholder,
 *  the rendition and the bitmap (made for the measured box) all lay out at
 *  the same height, so the swap moves nothing. */
export const PENDING_FACE_SRC =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='488' height='680'/%3E";

/** The card's own aspect, width over height: every Scryfall front rendition
 *  is 488:680 (the placeholder above draws the same box). */
export const CARD_FACE_ASPECT = 488 / 680;

/** How far a slot's box may stray from {@link CARD_FACE_ASPECT}, relative,
 *  and still get a bitmap. Every card slot is 5:7 to within rounding (a 46px
 *  tile at 64px reads 0.719 against 0.718); a box past this is a slot caught
 *  mid-layout — an alt-text line before the source lands, a collapsing panel —
 *  and a bitmap made for it is a strip that a content-sized slot then keeps as
 *  its own height (issue #9101: the hover preview's ~25px printed panel). */
export const CARD_FACE_ASPECT_TOLERANCE = 0.04;

/** Whether `box` is card-shaped enough to resample a face to. */
export function isCardShapedBox(box: { w: number; h: number }): boolean {
    if (box.w <= 0 || box.h <= 0) return false;
    return (
        Math.abs(box.w / box.h / CARD_FACE_ASPECT - 1) <=
        CARD_FACE_ASPECT_TOLERANCE
    );
}

export interface PrintedFaceSourceOptions {
    /** The Scryfall print to draw; `null` draws nothing (a token with no
     *  printed art, a face-down back). */
    imageId: string | null;
    face?: CardImageFace;
    /** FALLBACK `sizes` hint, used only when the slot cannot be measured — a
     *  zero-width box, or a test environment with no layout engine. */
    fallbackSizes: string;
    /** FALLBACK for `thumb`'s presence in the srcset, on the same
     *  cannot-measure path. */
    fallbackIncludeThumb: boolean;
    /** Take the 1x bitmap path (issue #8321); the default. */
    bitmap?: boolean;
    /** The face is in a lazy grid (`loading="lazy"` on the `<img>`): its
     *  bitmap is made only once the slot nears the viewport
     *  (`useNearViewport`), as the native lazy load would have fetched it —
     *  a search grid of hundreds of results must not resample them all. */
    lazy?: boolean;
    /** The real face has loaded (never the pending placeholder). */
    onLoad?: () => void;
    /** Every source failed — the WebP, the jpg — so the caller can end its
     *  loader. */
    onExhausted?: () => void;
}

export interface PrintedFaceSource<T extends HTMLElement> {
    /** Attach to the element whose box IS the slot. */
    slotRef: React.RefObject<T | null>;
    /** What the `<img>` renders; `null` while the slot is unmeasured — the
     *  caller renders no element then. */
    attrs: PrintedFaceAttrs | null;
    /** The `<img>`'s `onError`: steps to the next source. */
    onError: () => void;
    /** The `<img>`'s `onLoad`: forwards a real face's load, swallows the
     *  pending placeholder's, and refuses a bitmap that is not the slot's
     *  size. */
    onLoad: (e?: React.SyntheticEvent<HTMLImageElement>) => void;
}

/** The bitmap path's state for one (art, box) key. */
interface BitmapState {
    key: string;
    /** `null` once the resample failed or the bitmap itself failed to draw:
     *  the srcset path takes over for this key. */
    url: string | null;
}

/**
 * The ONE printed-face source contract (issue #3553, issue #8321): every
 * `<img data-card-face="printed">` in the app — the board card, the hover
 * preview's printed panel, the emblem and designation tiles, the library
 * order and pile division strips — derives its source from the slot it paints
 * into through this hook, so the rule holds everywhere by construction and a
 * call site cannot under-declare.
 *
 * THREE SOURCES, IN ORDER.
 *
 *   1. On a 1x display (`faceBitmapWanted`), the art resampled to the slot's
 *      exact device box (`~/lib/faceBitmaps.ts`): drawn 1:1, nothing for the
 *      compositor to step down, which is the defect class issue #8321 names.
 *      The `<img>` waits for it — a srcset painted first and swapped later
 *      would flash the grainy frame the path exists to remove, and the wait
 *      is the art's own fetch, which the srcset path would spend too.
 *   2. The responsive srcset against the measured floor (issue #3553) — every
 *      Retina display, the no-layout fallback, and a 1x display whose
 *      bitmap could not be made.
 *   3. The legacy jpg, when the WebP rendition is missing (a spoiler-season
 *      or low-res printing). A second failure calls `onExhausted`.
 *
 * Keyed by the image id, never a boolean: a memo-retained component that
 * switches identity re-tries the first source for the new card instead of
 * inheriting the previous card's failure.
 */
export default function usePrintedFaceSource<T extends HTMLElement>({
    imageId,
    face,
    fallbackSizes,
    fallbackIncludeThumb,
    bitmap = true,
    lazy = false,
    onLoad: onFaceLoad,
    onExhausted,
}: PrintedFaceSourceOptions): PrintedFaceSource<T> {
    const { slotRef, floor, measured, box } = useCardSlotFloor<T>();
    const artUrl = imageId ? getImageUrl(imageId, face) : null;
    // The art whose bitmap moved its own slot (see `onLoad`): this mount
    // draws that art from the srcset from then on. Keyed by the art, so a
    // memo-retained face that switches card tries the bitmap again.
    const [selfSizingArt, setSelfSizingArt] = useState<string | null>(null);
    const bitmapAllowed = bitmap && artUrl !== null && selfSizingArt !== artUrl;
    const near = useNearViewport(
        slotRef,
        lazy && bitmapAllowed && box !== null
    );
    const bitmapKey = bitmapKeyOf(
        bitmapAllowed &&
            measured &&
            (!lazy || near) &&
            box !== null &&
            isCardShapedBox(box) &&
            supportsFaceBitmaps()
            ? box
            : null,
        artUrl
    );
    const [bitmapState, setBitmapState] = useState<BitmapState | null>(null);
    const [jpgFallbackFor, setJpgFallbackFor] = useState<string | null>(null);

    useEffect(() => {
        if (!bitmapKey || !artUrl || !box) return;
        const handle = acquireFaceBitmap(artUrl, box.w, box.h);
        let live = true;
        // A face is never left pending: a bitmap that does not answer by
        // the resample timeout — whatever held it — falls to the srcset.
        // Measured on this lane: a choice dialog with five faces pending at
        // the 30 s settle mark.
        const watchdog = setTimeout(() => {
            if (live) setBitmapState({ key: bitmapKey, url: null });
        }, FACE_RESAMPLE_TIMEOUT_MS + 2_000);
        void handle.ready.then((url) => {
            clearTimeout(watchdog);
            if (live) setBitmapState({ key: bitmapKey, url });
        });
        return () => {
            live = false;
            clearTimeout(watchdog);
            handle.release();
        };
        // `bitmapKey` is a function of `artUrl` and `box`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bitmapKey]);

    const slot = floor ?? {
        sizes: fallbackSizes,
        includeThumb: fallbackIncludeThumb,
    };
    let attrs: PrintedFaceAttrs | null = null;
    if (measured && imageId && artUrl) {
        const bitmapReady =
            bitmapKey !== null && bitmapState?.key === bitmapKey
                ? bitmapState
                : null;
        // A lazy face on the bitmap path waits, source-less, until it nears
        // the viewport, then for its bitmap: never the srcset in between,
        // which would fetch (and paint) the frame this path exists to avoid.
        const lazyWaiting =
            lazy &&
            bitmapAllowed &&
            box !== null &&
            isCardShapedBox(box) &&
            !near &&
            supportsFaceBitmaps();
        if (lazyWaiting) {
            // Not near yet: no bitmap is being made, none is in flight.
            attrs = { src: PENDING_FACE_SRC, "data-face-pending": "deferred" };
        } else if (bitmapKey !== null && !bitmapReady) {
            // The bitmap is being made.
            attrs = { src: PENDING_FACE_SRC, "data-face-pending": "" };
        } else if (bitmapReady?.url) {
            attrs = { src: bitmapReady.url, "data-art-src": artUrl };
        } else if (jpgFallbackFor === imageId) {
            attrs = { src: getImageFallbackUrl(imageId, face) };
        } else {
            attrs = {
                src: artUrl,
                srcSet: getImageSrcSet(imageId, {
                    includeThumb: slot.includeThumb,
                    face,
                }),
                sizes: slot.sizes,
            };
        }
    }

    const pending = attrs !== null && "data-face-pending" in attrs;
    const onLoad = (e?: React.SyntheticEvent<HTMLImageElement>) => {
        if (pending) return;
        // A bitmap that is not the slot's size (a slot measured before its
        // layout settled — measured on this lane: 7px for a 60px tile, 28px
        // for 64px, 51px for 158px) must never show stretched: this key falls
        // to the srcset, today's path.
        const img = e?.currentTarget;
        if (img && attrs && "data-art-src" in attrs && box) {
            if (bitmapMismatchesBox(img, box)) {
                setBitmapState({ key: bitmapKey ?? "", url: null });
                return;
            }
            // The slot laid out WITH this bitmap (reading it forces that
            // layout) must still be the box the bitmap was made for. If it is
            // not, the slot takes its size from its own image — an
            // `inline-block` wrapper's strut gap under an `aspect-ratio`
            // tile, measured +5px a round (issue #9101) — and every bitmap
            // would key the next one, forever. Whatever the wrapper, this
            // mount stops resampling this art and draws the srcset.
            if (artUrl && slotMovedByBitmap(slotRef.current, box)) {
                setSelfSizingArt(artUrl);
                return;
            }
        }
        onFaceLoad?.();
    };
    const onError = () => {
        if (!imageId || pending) return;
        if (attrs && "data-art-src" in attrs) {
            // The bitmap would not draw: this key falls to the srcset.
            setBitmapState({ key: bitmapKey ?? "", url: null });
            return;
        }
        if (jpgFallbackFor !== imageId) setJpgFallbackFor(imageId);
        else onExhausted?.();
    };

    return { slotRef, attrs, onError, onLoad };
}

/** A loaded bitmap that is not its slot's box, in either dimension — a slot
 *  measured before its layout settled (measured on this lane: 7px for a 60px
 *  tile, 28px for 64px, 51px for 158px). It must never show stretched. A
 *  dimension the engine does not report (0) is not evidence. */
function bitmapMismatchesBox(img: HTMLImageElement, box: CardSlotBox): boolean {
    return (
        (img.naturalWidth > 0 && Math.abs(img.naturalWidth - box.w) > 1) ||
        (img.naturalHeight > 0 && Math.abs(img.naturalHeight - box.h) > 1)
    );
}

/** The slot's layout box, read now, is no longer the box its bitmap was made
 *  for (more than a device pixel off on either axis). A slot with no layout
 *  box at all (a test environment, a detached node) is not evidence. */
function slotMovedByBitmap(
    slot: HTMLElement | null,
    box: CardSlotBox
): boolean {
    if (!slot) return false;
    const w = slot.offsetWidth;
    const h = slot.offsetHeight;
    if (w <= 0 || h <= 0) return false;
    return (
        Math.abs(Math.round(w * box.dpr) - box.w) > 1 ||
        Math.abs(Math.round(h * box.dpr) - box.h) > 1
    );
}

function bitmapKeyOf(
    box: CardSlotBox | null,
    artUrl: string | null
): string | null {
    return box && artUrl ? faceBitmapKey(artUrl, box.w, box.h) : null;
}
