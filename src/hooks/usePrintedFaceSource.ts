import { useEffect, useState } from "react";
import {
    getImageFallbackUrl,
    getImageSrcSet,
    getImageUrl,
    type CardImageFace,
} from "~/lib/images";
import {
    acquireFaceBitmap,
    faceBitmapKey,
    supportsFaceBitmaps,
} from "~/lib/faceBitmaps";
import useCardSlotFloor, { type CardSlotBox } from "./useCardSlotFloor";

/** The attributes a printed-face `<img>` spreads: the responsive srcset, the
 *  jpg fallback, or the 1x bitmap with the art it was made from. */
export type PrintedFaceAttrs =
    | { src: string; srcSet: string; sizes: string }
    | { src: string }
    | { src: string; "data-art-src": string };

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
    /** Take the 1x bitmap path (issue #8321). `false` for a lazy, off-screen
     *  grid: the bitmap is made eagerly, which would defeat `loading="lazy"`. */
    bitmap?: boolean;
    /** Every source failed — the WebP, the jpg — so the caller can end its
     *  loader. */
    onExhausted?: () => void;
}

export interface PrintedFaceSource<T extends HTMLElement> {
    /** Attach to the element whose box IS the slot. */
    slotRef: React.RefObject<T | null>;
    /** What the `<img>` renders; `null` while the slot is unmeasured or the
     *  1x bitmap is still being made — the caller renders no source then. */
    attrs: PrintedFaceAttrs | null;
    /** The `<img>`'s `onError`: steps to the next source. */
    onError: () => void;
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
    onExhausted,
}: PrintedFaceSourceOptions): PrintedFaceSource<T> {
    const { slotRef, floor, measured, box } = useCardSlotFloor<T>();
    const artUrl = imageId ? getImageUrl(imageId, face) : null;
    const bitmapKey = bitmapKeyOf(
        bitmap && measured && supportsFaceBitmaps() ? box : null,
        artUrl
    );
    const [bitmapState, setBitmapState] = useState<BitmapState | null>(null);
    const [jpgFallbackFor, setJpgFallbackFor] = useState<string | null>(null);

    useEffect(() => {
        if (!bitmapKey || !artUrl || !box) return;
        const handle = acquireFaceBitmap(artUrl, box.w, box.h);
        let live = true;
        void handle.ready.then((url) => {
            if (live) setBitmapState({ key: bitmapKey, url });
        });
        return () => {
            live = false;
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
        if (bitmapKey !== null && !bitmapReady) {
            attrs = null; // the bitmap is being made
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

    const onError = () => {
        if (!imageId) return;
        if (attrs && "data-art-src" in attrs) {
            // The bitmap would not draw: this key falls to the srcset.
            setBitmapState({ key: bitmapKey ?? "", url: null });
            return;
        }
        if (jpgFallbackFor !== imageId) setJpgFallbackFor(imageId);
        else onExhausted?.();
    };

    return { slotRef, attrs, onError };
}

function bitmapKeyOf(
    box: CardSlotBox | null,
    artUrl: string | null
): string | null {
    return box && artUrl ? faceBitmapKey(artUrl, box.w, box.h) : null;
}
