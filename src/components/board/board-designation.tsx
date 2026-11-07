import { useState } from "react";
import type { StateDesignationDefinition } from "@convex/cards/designations";
import usePrintedFaceSource from "~/hooks/usePrintedFaceSource";
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
    // `loaded` hides the raw box while the bitmap streams in.
    const [loaded, setLoaded] = useState(false);
    // The tile's own box is the slot — measured, never a hand-written hint
    // (issue #3553); the one printed-face source contract (issue #8321)
    // owns the srcset, the 1x bitmap and the WebP → jpg fallback. No source
    // until the first measurement: see `useCardSlotFloor`.
    const { slotRef, attrs, onError, onLoad } =
        usePrintedFaceSource<HTMLDivElement>({
            imageId,
            fallbackSizes: "200px",
            fallbackIncludeThumb: false,
            onLoad: () => setLoaded(true),
            onExhausted: () => setLoaded(true),
        });

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
                <div
                    ref={slotRef}
                    className="w-full h-full card-corner overflow-hidden ring-1 ring-border-accent/60 bg-surface-base"
                >
                    {attrs && (
                        <img
                            data-card-face="printed"
                            {...attrs}
                            className="w-full h-full object-cover block select-none"
                            alt={designation.name}
                            decoding="async"
                            draggable={false}
                            onLoad={onLoad}
                            onError={onError}
                        />
                    )}
                    {!loaded && (
                        <div className="absolute inset-0 animate-pulse bg-surface-raised/60" />
                    )}
                </div>
            </div>
        </CardPreview>
    );
}
