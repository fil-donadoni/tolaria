import { useState } from "react";
import type { StateDesignationDefinition } from "@convex/cards/designations";
import { getImageFallbackUrl, getImageSrcSet, getImageUrl } from "~/lib/images";
import { buildDesignationPreviewBody } from "~/lib/preview-body";
import CardPreview from "../cards/card-preview";

/** A single state designation (The Monarch / City's Blessing) rendered as its
 *  printed marker-card Scryfall art — the emblem-parallel for a game-state
 *  status a player holds (issue #1199 / #1305). Structurally identical to
 *  {@link BoardEmblem}: the tile art URL is built from the designation's
 *  `imagePrintId` via the shared image helpers (`src/lib/images.ts`), with the
 *  same WebP-first, jpg-onError fallback the battlefield {@link CardImage} uses,
 *  and the hover/right-click preview is driven by a hand-built
 *  {@link buildDesignationPreviewBody} face passed through `CardPreview`'s
 *  `bodyOverride`. A designation always has a marker print, so there is no
 *  text-placeholder branch. */
export default function BoardDesignation({
    designation,
    testId,
}: {
    designation: StateDesignationDefinition;
    testId: string;
}) {
    const imageId = designation.imagePrintId;
    // WebP → jpg fallback, keyed off the image id (mirrors CardImage). `loaded`
    // hides the raw box while the bitmap streams in.
    const [jpgFallback, setJpgFallback] = useState(false);
    const [loaded, setLoaded] = useState(false);

    return (
        <CardPreview
            cardId={designation.id}
            cardName={designation.name}
            bodyOverride={buildDesignationPreviewBody(designation)}
        >
            <div
                data-testid={testId}
                className="relative w-full h-full"
                aria-label={`Designation: ${designation.name}.`}
            >
                <div className="w-full h-full rounded-sm overflow-hidden ring-1 ring-border-accent/60 bg-surface-base">
                    <img
                        {...(jpgFallback
                            ? { src: getImageFallbackUrl(imageId) }
                            : {
                                  src: getImageUrl(imageId),
                                  srcSet: getImageSrcSet(imageId, {
                                      includeThumb: false,
                                  }),
                                  sizes: "200px",
                              })}
                        className="w-full h-full object-cover block select-none"
                        alt={designation.name}
                        decoding="async"
                        draggable={false}
                        onLoad={() => setLoaded(true)}
                        onError={() => {
                            if (!jpgFallback) setJpgFallback(true);
                            else setLoaded(true);
                        }}
                    />
                    {!loaded && (
                        <div className="absolute inset-0 animate-pulse bg-surface-raised/60" />
                    )}
                </div>
            </div>
        </CardPreview>
    );
}
