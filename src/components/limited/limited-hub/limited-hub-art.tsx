import type { PackSourceInfo } from "~/hooks/useLimitedEvent";
import { getArtCropImageUrl, resolveCardImageId } from "~/lib/images";

/** A Pack Source's Feature Card art as a tile background, under a scrim that
 *  keeps the text on top readable. Absolutely positioned: the parent tile owns
 *  the size and clipping. A source with no Feature Card (or none known yet)
 *  leaves the plain tile surface. */
export default function LimitedHubArt({
    source,
}: {
    source: PackSourceInfo | undefined;
}) {
    const imageId =
        source?.featureCardId != null
            ? resolveCardImageId(source.featureCardId)
            : null;
    return (
        <>
            {imageId && (
                <img
                    src={getArtCropImageUrl(imageId)}
                    alt=""
                    data-card-face="art"
                    loading="lazy"
                    className="absolute inset-0 -z-10 size-full object-cover"
                />
            )}
            <span
                aria-hidden="true"
                className="absolute inset-0 -z-10 bg-gradient-to-t from-surface via-surface/60 to-surface/10"
            />
        </>
    );
}
