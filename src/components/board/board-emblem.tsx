import { useState } from "react";
import type { EmblemInstance } from "@convex/cards/types";
import { getImageFallbackUrl, getImageSrcSet, getImageUrl } from "~/lib/images";
import { buildEmblemPreviewBody } from "~/lib/preview-body";
import CardPreview from "../cards/card-preview";
import useCardSlotFloor from "~/hooks/useCardSlotFloor";

/** A single command-zone emblem (CR 114) rendered as its printed Scryfall art
 *  (layout `emblem`, e.g. Sorin, Lord of Innistrad Emblem). The tile art URL is
 *  built from the wire-denormalized `imagePrintId` via the shared image
 *  helpers (`src/lib/images.ts`) — the same WebP-first, jpg-onError fallback
 *  the battlefield {@link CardImage} uses. An emblem is NOT a card registry
 *  entry, so `CardImage`/`buildPreviewBody` (which resolve a `CardDefinition`)
 *  can't be reused; the hover/right-click preview is driven by a hand-built
 *  {@link buildEmblemPreviewBody} face passed through `CardPreview`'s
 *  `bodyOverride`, so the emblem gets the full zoom + oracle-text UX every card
 *  has. When the def declares no `imagePrintId` the tile falls back to an
 *  in-app text placeholder (name + oracle text). */
export default function BoardEmblem({ emblem }: { emblem: EmblemInstance }) {
    const imageId = emblem.imagePrintId;
    // WebP → jpg fallback, keyed off the image id so a re-used slot re-tries
    // WebP for a new emblem (mirrors CardImage). `loaded` hides the raw box
    // while the bitmap streams in.
    const [jpgFallback, setJpgFallback] = useState(false);
    const [loaded, setLoaded] = useState(false);
    // The tile's own box is the slot — measured, never a hand-written hint
    // (issue #3553). No source until the first measurement.
    const { slotRef, floor, measured } = useCardSlotFloor<HTMLDivElement>();

    return (
        <CardPreview
            cardId={emblem.emblemId}
            cardName={emblem.name}
            bodyOverride={buildEmblemPreviewBody(emblem)}
        >
            <div
                data-testid={`emblem-${emblem.id}`}
                className="relative w-full h-full"
                aria-label={`Emblem: ${emblem.name}. ${emblem.text}`}
            >
                <div
                    ref={slotRef}
                    className="w-full h-full card-corner overflow-hidden ring-1 ring-border-accent/60 bg-surface-base"
                >
                    {imageId ? (
                        // `measured &&`, not `imageId && measured ?` — a
                        // not-yet-measured card must render NOTHING for the
                        // frame, never the no-art placeholder.
                        measured && (
                            <img
                                data-card-face="printed"
                                {...(jpgFallback
                                    ? { src: getImageFallbackUrl(imageId) }
                                    : {
                                          src: getImageUrl(imageId),
                                          srcSet: getImageSrcSet(imageId, {
                                              includeThumb:
                                                  floor?.includeThumb ?? false,
                                          }),
                                          // "hint generously" used to live here —
                                          // a 200px constant guessing at a tile
                                          // that paints at ~--card-w-sm. The hint
                                          // is the measured slot now (issue #3553).
                                          sizes: floor?.sizes ?? "200px",
                                      })}
                                className="w-full h-full object-cover block select-none"
                                alt={emblem.name}
                                decoding="async"
                                draggable={false}
                                onLoad={() => setLoaded(true)}
                                onError={() => {
                                    if (!jpgFallback) setJpgFallback(true);
                                    else setLoaded(true);
                                }}
                            />
                        )
                    ) : (
                        <EmblemPlaceholder
                            name={emblem.name}
                            text={emblem.text}
                        />
                    )}
                    {imageId && !loaded && (
                        <div className="absolute inset-0 animate-pulse bg-surface-raised/60" />
                    )}
                </div>
            </div>
        </CardPreview>
    );
}

/** In-app fallback for an emblem with no printed art: name over the oracle
 *  text, in the same parchment card frame as {@link TokenPlaceholder}. */
function EmblemPlaceholder({ name, text }: { name: string; text: string }) {
    return (
        <div className="relative w-full h-full bg-parchment text-surface-base card-corner border border-border-strong flex flex-col">
            <div className="px-1.5 py-1 border-b border-border-strong/60 bg-accent-soft/40 text-[0.55em] font-semibold leading-tight">
                {name}
            </div>
            <div className="px-1.5 py-0.5 border-b border-border-strong/40 bg-accent-soft/25 text-[0.45em] italic leading-tight">
                Emblem
            </div>
            <div className="flex-1 px-1.5 py-1 text-[0.5em] leading-tight overflow-hidden">
                {text}
            </div>
        </div>
    );
}
