import { memo, useState } from "react";
import {
    DEFAULT_CARD_IMAGE_SIZES,
    getImageFallbackUrl,
    getImageSrcSet,
    getImageUrl,
    resolveCardImageFace,
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
import ColorRingOverlay from "./color-ring-overlay";
import { getEffectiveColorDisplay } from "~/lib/color-override";
import useCardSlotFloor from "~/hooks/useCardSlotFloor";
import { useTokenPrints } from "~/hooks/useTokenPrints";
import { resolveArtPrintId } from "~/lib/tokenArt";

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
//
// Eviction is a function of the GPU budget, not only of the card count (issue
// #6940). Measured on the Draft pack grid (15 cards) and the Limited pool
// builder (40+ cards) with `check:ui`'s rasterisation probe (`raster.js`):
// under a starved budget (`--force-gpu-mem-available-mb=24`, the shape of a
// 16 GB laptop under memory pressure) PROMOTED faces were evicted to blank
// slots on two of ten cells, while the same surfaces with CONTAINED faces, the
// same budget, max zoom and a hovered tile read sharp on all ten. With an
// ordinary budget both modes read sharp — which is why no earlier walk saw it.
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
     * FALLBACK `sizes` hint, used only when the slot cannot be measured — a
     * zero-width box, or a test environment with no layout engine. A real
     * browser render derives the hint from the slot itself
     * (`useCardSlotFloor`), so this prop no longer decides the rendition and
     * a call site that omits it is no longer under-declaring (issue #3553).
     */
    sizes?: string;
    /**
     * FALLBACK for `thumb`'s presence in the srcset, on the same
     * cannot-measure path as `sizes`. Measured slots derive it from
     * `cardSlotFloor`: `thumb` is 146 real pixels, so it stays a candidate
     * exactly while the slot needs 146 device px or fewer.
     */
    includeThumb?: boolean;
    /**
     * Promote the card to its own compositor layer (default `true` — the
     * board's behaviour, unchanged). Pass `false` on any surface that renders
     * an unbounded number of cards at once and does not ROTATE or SCALE their
     * ancestors — see {@link CONTAINED_LAYER} for what over-promotion costs.
     * A translate-only hover lift is not a reason to promote: a translation
     * never changes the raster scale, so the contained card stays sharp
     * through it (measured, issue #6940). The Draft pack tile and the deck
     * builder tile pass `false`; `unbounded-card-surfaces-contained-layer.test.tsx`
     * keeps them there.
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
    // The wrapper below IS the slot — the image fills it — so its measured
    // width is what the srcset hint must describe (issue #3553). Until the
    // first measurement lands the `<img>` carries no source at all: a hint
    // applied after the browser has already picked a candidate cannot
    // un-pick it, and the whole defect is a candidate picked at first paint.
    const {
        slotRef,
        floor,
        measured: slotMeasured,
    } = useCardSlotFloor<HTMLDivElement>();
    const slot = floor ?? { sizes, includeThumb };
    const [loaded, setLoaded] = useState(false);
    const tokenPrints = useTokenPrints();
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
    // CR 613.1e — a layer-5 colour (`colorOverride` / `grantedColors`) rings
    // the card wherever it is drawn, not only on the battlefield: an
    // every-zone grant (Painter's Servant) colours hand, graveyard and exile
    // cards too. A face-down object is ringed as well: its face-down values
    // are copiable values (CR 708.2) and layer 5 still applies on top, so a
    // face-down 2/2 under Painter's Servant IS the chosen colour — and only
    // that colour, since the sentinel face has no mana cost.
    const colorRing = cardInstance
        ? getEffectiveColorDisplay(cardInstance)
        : null;
    // Tokens (CR 111, 707.1) prefer a printed token's Scryfall id for art
    // when the card defines one (e.g. The Hive → 10E Wasp print). Tokens
    // without a printed image render the in-app TokenPlaceholder.
    //
    // A token with no printed image of its own (every auto-resolved one since
    // issue #4120) gets the Token Print of the edition that created it, off
    // the instance's `sourcePrintId` and the Game-load rows (`tokenArt.ts`).
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
        : resolveArtPrintId(defId, cardInstance, tokenPrints);
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
                ref={slotRef}
                className="relative w-full h-full card-corner overflow-hidden"
                style={promoteLayer ? STABLE_LAYER : CONTAINED_LAYER}
            >
                {faceDownFace?.kind === "back" ? (
                    <CardBack />
                ) : imageId ? (
                    // `slotMeasured &&` INSIDE the `imageId` branch, never
                    // `imageId && slotMeasured ?` — a card whose slot has not
                    // been measured yet must render nothing for that frame,
                    // never the token placeholder, which is the "this card has
                    // no printed art" face.
                    slotMeasured && (
                        <img
                            data-card-face="printed"
                            {...(jpgFallbackFor === imageId
                                ? { src: getImageFallbackUrl(imageId, face) }
                                : {
                                      src: getImageUrl(imageId, face),
                                      srcSet: getImageSrcSet(imageId, {
                                          includeThumb: slot.includeThumb,
                                          face,
                                      }),
                                      sizes: slot.sizes,
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
                    )
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
                {colorRing && <ColorRingOverlay display={colorRing} />}
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
// types/subtypes, granted activated/triggered abilities, and the layer-5
// colours (`colorOverride`, `grantedColors`) the colour ring paints.
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
