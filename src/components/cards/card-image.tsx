import { memo, useState } from "react";
import {
    DEFAULT_CARD_IMAGE_SIZES,
    getImageFallbackUrl,
    getImageSrcSet,
    getImageUrl,
    resolveCardImageFace,
    resolveCardImageId,
} from "~/lib/images";
import { tryGetDefinition } from "@convex/cards";
import type { CardInstance } from "~/types/game";
import {
    cardImageSignature,
    getCardImageDefId,
} from "~/lib/card-image-signature";
import {
    faceDownProducer,
    isFaceDownCard,
    resolveFaceDownFace,
} from "~/lib/face-down";
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

// The same containment WITHOUT the forced compositor layer, for surfaces that
// render an unbounded number of cards and never animate their ancestors.
//
// `will-change: transform` + `translateZ(0)` promote every card to its own GPU
// layer. That is a good trade on the board (a few dozen cards, ancestors
// genuinely rotating) and a bad one in a scrolling result grid: at ~240 cards
// Chrome exhausts its tile memory and starts EVICTING layers, which paints as
// blank regions, cards that flicker in and out on hover, and images decoded at
// the `sizes` hint (140px) instead of their 488px intrinsic width. A sticky
// `backdrop-filter` above the grid compounds it — the blur must read back the
// composited result underneath on every frame.
//
// `contain: paint` survives because it is a hint, not a promotion.
const CONTAINED_LAYER: React.CSSProperties = { contain: "paint" };

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
    /**
     * Promote the card to its own compositor layer (default `true` — the
     * board's behaviour, unchanged). Pass `false` on any surface that renders
     * an unbounded number of cards at once and does not animate their
     * ancestors — see {@link CONTAINED_LAYER} for what over-promotion costs.
     */
    promoteLayer?: boolean;
    /**
     * Forwarded to {@link CardPreview}: pass `false` on an EDITING surface
     * (deckbuilder tile, draft pack card, search result) where a 250ms touch
     * hold is the DRAG, not a preview (PRD #2405 gesture model A, issue
     * #2583). Defaults to `true` — every board/pile/lobby usage is unchanged.
     */
    holdPreview?: boolean;
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
    promoteLayer = true,
    holdPreview = true,
}: CardImageProps) {
    const cardInstance = isCardInstance(card) ? card : undefined;
    const defId = getDefId(card);
    const [loaded, setLoaded] = useState(false);
    // WebP-first with jpg fallback. Keyed to the image id (not a boolean) so a
    // memo-retained component that switches identity re-tries WebP for the new
    // card instead of inheriting the previous card's failure.
    const [jpgFallbackFor, setJpgFallbackFor] = useState<string | null>(null);
    // A face-down object (CR 708.2 permanent/spell, CR 406.3 exiled card)
    // renders a FACE-DOWN FACE for every viewer, its controller included —
    // `getCardImageDefId` has already collapsed `defId` to the sentinel, which
    // has no Scryfall art of its own (issue #2904). WHICH face is a property of
    // the mechanic that hid it, resolved through the one producer-keyed table
    // (`~/lib/face-down.ts`); today every censused producer resolves to the
    // generic card back.
    //
    // This is NOT an early return any more: it used to `return <CardBack />`
    // before the `CardPreview` wrapper below, which left a face-down card the
    // only card on the board with no hover/hold/pin preview at all. The
    // affordance is now always present — for a non-entitled viewer it opens on
    // a single anonymous face, which leaks nothing.
    const faceDownFace = isFaceDownCard(card)
        ? resolveFaceDownFace(faceDownProducer(card))
        : null;
    const def = tryGetDefinition(defId);
    const name = def?.name ?? defId;
    // Tokens (CR 111, 707.1) prefer a printed token's Scryfall id for art
    // when the card defines one (e.g. The Hive → 10E Wasp print). Tokens
    // without a printed image render the in-app TokenPlaceholder.
    //
    // An INSTANCE-level pin wins over both (CR 111 / 707.2): a token COPY
    // presents the copied card's definition, so a definition-keyed lookup would
    // render the creature's own printing — wrong for an Eternalize / Embalm
    // token, which has its own printed token card (a black Zombie frame).
    //
    // A face-down face overrides BOTH: the instance's `imagePrintId` is the
    // hidden card's own printing pin (a token copy's black Zombie frame), which
    // is exactly the identity that must not paint here.
    const imageId = faceDownFace
        ? faceDownFace.kind === "print"
            ? faceDownFace.imagePrintId
            : null
        : (cardInstance?.imagePrintId ?? resolveCardImageId(defId));
    // A transformed permanent's `defId` is swapped to its registered
    // back-face definition (CR 712, `gre/transform.ts`); resolve which
    // Scryfall CDN face segment that definition renders (issue #1595). A
    // face-down face is never a transform back face.
    const face = faceDownFace ? "front" : resolveCardImageFace(defId);
    return (
        <CardPreview
            cardId={defId}
            cardName={name}
            cardInstance={cardInstance}
            showCopyBadge={showCopyBadge}
            holdPreview={holdPreview}
        >
            <div
                className="relative w-full h-full card-corner overflow-hidden"
                style={promoteLayer ? STABLE_LAYER : CONTAINED_LAYER}
            >
                {faceDownFace?.kind === "back" ? (
                    <CardBack />
                ) : imageId ? (
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
        prev.promoteLayer === next.promoteLayer &&
        prev.holdPreview === next.holdPreview &&
        cardImageSignature(prev.card) === cardImageSignature(next.card)
);
export default CardImage;
