import type { CardImageFace } from "~/lib/images";
import usePrintedFaceSource from "~/hooks/usePrintedFaceSource";

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
    // The element IS the slot. No source until it has been measured (and, on
    // a 1x display, resampled to it — issue #8321): a hint applied after the
    // browser has already resolved a candidate cannot un-resolve it, and
    // first paint is the whole point. A slot that could not be measured keeps
    // the widest hint rather than the narrowest: this component only ever
    // renders into large panels, so over-declaring is the safe direction.
    const { slotRef, attrs, onError } = usePrintedFaceSource<HTMLImageElement>({
        imageId,
        face,
        fallbackSizes: "672px",
        fallbackIncludeThumb: false,
        // A second failure still ends the caller's loader.
        onExhausted: onLoad,
    });
    return (
        <img
            ref={slotRef}
            data-card-face="printed"
            {...(backFaceMarker
                ? { "data-card-preview-back-face-printed": true }
                : {})}
            {...(attrs ?? {})}
            alt={alt}
            className={className}
            decoding="async"
            draggable={false}
            onLoad={onLoad}
            onError={onError}
        />
    );
}
