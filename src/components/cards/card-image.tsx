import { memo, useState } from "react";
import { getImageUrl, resolveCardImageId } from "~/lib/images";
import { tryGetDefinition } from "@convex/cards";
import type { CardInstance } from "~/types/game";
import {
    cardImageSignature,
    getCardImageDefId,
} from "~/lib/card-image-signature";
import CardPreview from "./card-preview";
import CardImageLoader from "./card-image-loader";
import TokenPlaceholder from "./token-placeholder";

// `contain: paint` + promoted layer keep Chrome's compositor from shipping
// the bitmap as a low-res tile while ancestors are transitioning/rotating.
const STABLE_LAYER: React.CSSProperties = {
    contain: "paint",
    transform: "translateZ(0)",
    willChange: "transform",
    backfaceVisibility: "hidden",
};

type CardImageProps = {
    card: CardInstance | { id: string };
    /**
     * Opt-in native lazy loading (`loading="lazy"`) for the art `<img>`.
     * Defaults to `false` so shared in-game usages — the battlefield mounts
     * CardImage thousands of times per render — keep fetching art eagerly and
     * their behavior is unchanged. The deck-builder search grid (ResultCard)
     * sets it so off-screen results only fetch art as they near the viewport.
     */
    lazy?: boolean;
    /**
     * Show a `Copy` badge on the hover/zoom preview (spell copy on the stack,
     * CR 707.10). Forwarded to CardPreview. Permanent copies show a second
     * printed face instead, driven by `cardInstance.copiedFrom`.
     */
    showCopyBadge?: boolean;
};

function isCardInstance(
    card: CardInstance | { id: string }
): card is CardInstance {
    return "controllerId" in card;
}

function getDefId(card: CardInstance | { id: string }): string {
    return getCardImageDefId(card);
}

function CardImageImpl({
    card,
    lazy = false,
    showCopyBadge = false,
}: CardImageProps) {
    const cardInstance = isCardInstance(card) ? card : undefined;
    const defId = getDefId(card);
    const def = tryGetDefinition(defId);
    const name = def?.name ?? defId;
    // Tokens (CR 111, 707.1) prefer a printed token's Scryfall id for art
    // when the card defines one (e.g. The Hive → 10E Wasp print). Tokens
    // without a printed image render the in-app TokenPlaceholder.
    const imageId = resolveCardImageId(defId);
    const [loaded, setLoaded] = useState(false);
    return (
        <CardPreview
            cardId={defId}
            cardName={name}
            cardInstance={cardInstance}
            showCopyBadge={showCopyBadge}
        >
            <div
                className="relative w-full h-full rounded-[7%] overflow-hidden"
                style={STABLE_LAYER}
            >
                {imageId ? (
                    <img
                        src={getImageUrl(imageId)}
                        className="w-full h-full object-cover block select-none"
                        style={{ WebkitTouchCallout: "none" }}
                        alt={name}
                        decoding="async"
                        {...(lazy ? { loading: "lazy" as const } : {})}
                        draggable={false}
                        onLoad={() => setLoaded(true)}
                        onError={() => setLoaded(true)}
                    />
                ) : (
                    <TokenPlaceholder
                        name={name}
                        types={def?.types ?? []}
                        subtypes={def?.subtypes ?? []}
                        power={def?.power}
                        toughness={def?.toughness}
                        staticAbilities={def?.staticAbilities ?? []}
                    />
                )}
                {imageId && !loaded && <CardImageLoader />}
            </div>
        </CardPreview>
    );
}

// Memo on a CHEAP derived signature of every live-instance field the zoom
// preview / badges render (#447) — CardImage is invoked thousands of times per
// render and repaints would re-trigger Chrome's compositor downsample, so the
// comparator stays a single string compare (never a deep object compare). The
// signature covers granted/lost keywords (landwalk AND every other keyword via
// `staticAbilities`), effective P/T inputs (base P/T, counters, temp mods),
// types/subtypes, granted activated/triggered abilities, and `colorOverride`.
// Any of those changing re-renders so the preview reflects the live instance;
// fields the preview ignores (tap/combat/summoning flags) are excluded so
// unrelated state churn doesn't repaint. See `card-image-signature.ts`.
const CardImage = memo(
    CardImageImpl,
    (prev, next) =>
        prev.lazy === next.lazy &&
        prev.showCopyBadge === next.showCopyBadge &&
        cardImageSignature(prev.card) === cardImageSignature(next.card)
);
export default CardImage;
