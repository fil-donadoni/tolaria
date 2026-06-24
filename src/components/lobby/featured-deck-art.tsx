import { useState } from "react";
import { ImageOff } from "lucide-react";
import { getArtCropImageUrl, resolveCardImageId } from "~/lib/images";
import { cn } from "~/lib/utils";

interface FeaturedDeckArtProps {
    /** Resolved Featured Card ID (PRD #589, issue #593) — a Scryfall printing id
     *  whose art represents the deck. `null` for an empty deck. */
    featuredCardId: string | null;
    className?: string;
    /** Tailwind `object-position` helper; the hero splash centres higher than a
     *  square thumbnail to keep the card's focal art in frame. */
    objectPosition?: string;
    /** Reduce colour intensity so faint atmospheres don't fight the chrome. */
    dim?: boolean;
}

/**
 * Featured-art renderer (PRD #589, issue #600) — paints the art_crop of a deck's
 * resolved Featured Card via the shared image layer
 * (`getArtCropImageUrl(resolveCardImageId(cardId))`, `src/lib/images.ts`).
 *
 * Graceful fallback (story 13/17): a deck with no resolvable card art — an empty
 * deck (`featuredCardId === null`) or a token-only card whose printing id can't
 * be resolved — renders an in-app placeholder instead of a broken image. A
 * runtime load error (CDN 404) flips to the same placeholder.
 */
export default function FeaturedDeckArt({
    featuredCardId,
    className,
    objectPosition = "object-center",
    dim = false,
}: FeaturedDeckArtProps) {
    const [errored, setErrored] = useState(false);
    const scryfallId = featuredCardId
        ? resolveCardImageId(featuredCardId)
        : null;
    const showArt = scryfallId !== null && !errored;

    return (
        <div
            className={cn(
                "relative overflow-hidden bg-surface-elevated",
                className
            )}
        >
            {showArt ? (
                <img
                    src={getArtCropImageUrl(scryfallId)}
                    alt=""
                    aria-hidden
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    onError={() => setErrored(true)}
                    className={cn(
                        "absolute inset-0 h-full w-full select-none object-cover",
                        objectPosition
                    )}
                    style={dim ? { filter: "saturate(0.85)" } : undefined}
                />
            ) : (
                <div
                    aria-hidden
                    className="absolute inset-0 flex items-center justify-center text-border-accent"
                    style={{
                        background:
                            "radial-gradient(circle at 50% 35%, color-mix(in oklab, var(--color-accent-soft) 40%, transparent), var(--color-surface) 75%)",
                    }}
                >
                    <ImageOff className="h-1/3 max-h-10 w-1/3 max-w-10 opacity-60" />
                </div>
            )}
        </div>
    );
}
