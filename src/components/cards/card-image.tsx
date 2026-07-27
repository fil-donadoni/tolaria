import { memo, useState } from "react";
import {
    DEFAULT_CARD_IMAGE_SIZES,
    getImageFallbackUrl,
    getImageSrcSet,
    getImageUrl,
    resolveCardImageFace,
    resolveCardImageId,
} from "~/lib/images";
import { tryGetDefinition, FACE_DOWN_CARD_ID } from "@convex/cards";
import type { CardInstance } from "~/types/game";
import {
    cardImageSignature,
    getCardImageDefId,
} from "~/lib/card-image-signature";
import CardPreview from "./card-preview";
import CardImageLoader from "./card-image-loader";
import TokenPlaceholder from "./token-placeholder";
import CardBack from "./card-back";

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
    /**
     * `sizes` hint for the responsive srcset — the card's rendered CSS width.
     * Defaults to the board's upper bound (140px); pass the real width when a
     * surface renders cards substantially larger (dialogs, deck builder) so
     * the browser upgrades to the `display` rendition instead of upscaling.
     */
    sizes?: string;
    /**
     * Keep Scryfall's `thumb` 146w rendition in the srcset (default true).
     * Mid-size slots (≥96px CSS — hand, stack, battlefield, pickers) pass
     * `false` so a 1× display resolves `grid` 488w instead of the visibly
     * softer `thumb`; small slots keep it for the bytes. See the rendition
     * strategy on `getImageSrcSet` (src/lib/images.ts).
     */
    includeThumb?: boolean;
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
    sizes = DEFAULT_CARD_IMAGE_SIZES,
    includeThumb = true,
}: CardImageProps) {
    const cardInstance = isCardInstance(card) ? card : undefined;
    const defId = getDefId(card);
    const [loaded, setLoaded] = useState(false);
    // WebP-first with jpg fallback. Keyed to the image id (not a boolean) so a
    // memo-retained component that switches identity re-tries WebP for the new
    // card instead of inheriting the previous card's failure.
    const [jpgFallbackFor, setJpgFallbackFor] = useState<string | null>(null);
    // A face-down permanent (CR 708.2, ADR 0013) reaches non-controller viewers
    // as the sentinel id `face-down:2-2-vanilla` (gameProjections hides the real
    // identity). There is no Scryfall art for the sentinel — render the card
    // back instead of fetching a 404 URL, and skip CardPreview so hover never
    // leaks a hidden identity. (After the hook so hook order stays stable.)
    if (defId === FACE_DOWN_CARD_ID) return <CardBack />;
    const def = tryGetDefinition(defId);
    const name = def?.name ?? defId;
    // Tokens (CR 111, 707.1) prefer a printed token's Scryfall id for art
    // when the card defines one (e.g. The Hive → 10E Wasp print). Tokens
    // without a printed image render the in-app TokenPlaceholder.
    const imageId = resolveCardImageId(defId);
    // A transformed permanent's `defId` is swapped to its registered
    // back-face definition (CR 712, `gre/transform.ts`); resolve which
    // Scryfall CDN face segment that definition renders (issue #1595).
    const face = resolveCardImageFace(defId);
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
                        {...(jpgFallbackFor === imageId
                            ? { src: getImageFallbackUrl(imageId, face) }
                            : {
                                  src: getImageUrl(imageId, face),
                                  srcSet: getImageSrcSet(imageId, {
                                      includeThumb,
                                      face,
                                  }),
                                  sizes,
                              })}
                        className="w-full h-full object-cover block select-none"
                        style={{ WebkitTouchCallout: "none" }}
                        alt={name}
                        decoding="async"
                        {...(lazy ? { loading: "lazy" as const } : {})}
                        draggable={false}
                        onLoad={() => setLoaded(true)}
                        onError={() => {
                            // WebP missing (spoiler/lowres printing) → retry
                            // as jpg; a second failure ends the loader.
                            if (jpgFallbackFor !== imageId)
                                setJpgFallbackFor(imageId);
                            else setLoaded(true);
                        }}
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
        prev.sizes === next.sizes &&
        prev.includeThumb === next.includeThumb &&
        cardImageSignature(prev.card) === cardImageSignature(next.card)
);
export default CardImage;
