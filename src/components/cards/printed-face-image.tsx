import { useState } from "react";
import {
    getImageFallbackUrl,
    getImageSrcSet,
    getImageUrl,
    type CardImageFace,
} from "~/lib/images";
import useCardSlotFloor from "~/hooks/useCardSlotFloor";

/**
 * The PRINTED full card face, rendered responsively into whatever slot it is
 * given (issue #3553).
 *
 * The preview's "Printed" toggle and the Inspect Overlay both used to render a
 * bare `<img src={printedImageSrc}>` — one fixed rendition, `grid` 488w, no
 * `srcset` and no `sizes` — into the widest card slots in the app: the hover
 * dock's printed panel is `OVERLAY_WIDTH × overlayFactor` (384px, or 768px for
 * a two-identity copy preview) and the Inspect Overlay's is up to 720px. At 2×
 * that is 768-1536 device pixels asking a 488px bitmap to fill them, which is
 * a worse ratio than the 180px draft slot the issue was filed about.
 *
 * Extracted rather than inlined at each site because it is the same element
 * twice and because the two would drift: one component per file is the rule,
 * and this one owns the whole printed-face contract — measured `sizes`, the
 * `thumb`-or-not decision, the WebP→jpg `onError` fallback, and the
 * `data-card-face="printed"` marker that puts it inside `check:ui`'s
 * `cardsSoft` scope.
 *
 * THE CEILING IS REAL AND NOT HIDDEN. Scryfall's widest rendition in this
 * srcset is `display` 672w, so a 384px slot at 2× (768 device px) cannot be
 * fully covered by anything this app may fetch — widening the ladder means
 * adding a CDN rendition, which issue #3553 puts out of scope. What this
 * component does is take the resolution from 488w to 672w and make the
 * remaining shortfall a MEASURED number on the surface's budget row instead of
 * an invisible one.
 */
export default function PrintedFaceImage({
    imageId,
    face,
    alt,
    className,
    onLoad,
    backFaceMarker = false,
}: {
    imageId: string;
    face: CardImageFace;
    alt: string;
    /** The slot's own classes. The element IS the slot here — these surfaces
     *  size the image directly rather than filling a wrapper. */
    className: string;
    onLoad?: () => void;
    /** Render `data-card-preview-back-face-printed`, the hook the preview's
     *  printed BACK image carries (CR 712, issue #3552). An attribute rather
     *  than a class because it addresses the back face specifically and
     *  carries no styling. */
    backFaceMarker?: boolean;
}) {
    const { slotRef, floor, measured } = useCardSlotFloor<HTMLImageElement>();
    const [jpgFallback, setJpgFallback] = useState(false);
    return (
        <img
            ref={slotRef}
            data-card-face="printed"
            {...(backFaceMarker
                ? { "data-card-preview-back-face-printed": true }
                : {})}
            // No source until the slot has been measured: a hint applied after
            // the browser has already resolved a candidate cannot un-resolve
            // it, and first paint is the whole point. `useLayoutEffect` runs
            // before paint, so this costs one commit, never a visible frame.
            {...(measured
                ? jpgFallback
                    ? { src: getImageFallbackUrl(imageId, face) }
                    : {
                          src: getImageUrl(imageId, face),
                          srcSet: getImageSrcSet(imageId, {
                              includeThumb: floor?.includeThumb ?? false,
                              face,
                          }),
                          // A slot that could not be measured keeps the widest
                          // hint rather than the narrowest: this component only
                          // ever renders into large panels, so over-declaring
                          // is the safe direction here.
                          sizes: floor?.sizes ?? "672px",
                      }
                : {})}
            alt={alt}
            className={className}
            decoding="async"
            draggable={false}
            onLoad={onLoad}
            onError={() => {
                // WebP missing (spoiler / lowres printing) → retry as jpg; a
                // second failure still ends the caller's loader.
                if (!jpgFallback) setJpgFallback(true);
                else onLoad?.();
            }}
        />
    );
}
