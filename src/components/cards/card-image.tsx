import { memo, useState } from "react";
import { getImageUrl } from "~/lib/images";
import { tryGetCardById } from "@convex/cards";
import type { CardInstance } from "~/types/game";
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
};

function isCardInstance(
    card: CardInstance | { id: string }
): card is CardInstance {
    return "controllerId" in card;
}

function getDefId(card: CardInstance | { id: string }): string {
    return isCardInstance(card) ? card.card.id : card.id;
}

function CardImageImpl({ card }: CardImageProps) {
    const cardInstance = isCardInstance(card) ? card : undefined;
    const defId = getDefId(card);
    const def = tryGetCardById(defId);
    const name = def?.name ?? defId;
    // Tokens (CR 111, 707.1) prefer a printed token's Scryfall id for art
    // when the card defines one (e.g. The Hive → 10E Wasp print). Tokens
    // without a printed image render the in-app TokenPlaceholder.
    const isToken = defId.startsWith("token:");
    const imageId = def?.imagePrintId ?? (isToken ? null : defId);
    const [loaded, setLoaded] = useState(false);
    return (
        <CardPreview cardId={defId} cardName={name} cardInstance={cardInstance}>
            <div
                className="relative w-full h-full rounded-sm overflow-hidden"
                style={STABLE_LAYER}
            >
                {imageId ? (
                    <img
                        src={getImageUrl(imageId)}
                        className="w-full h-full object-cover block"
                        alt={name}
                        decoding="async"
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

// Memo on def id only — CardImage is invoked thousands of times per render and
// repaints would re-trigger Chrome's compositor downsample. Override changes
// (granted/lost abilities, P/T) reflect on the next zoom invocation rather
// than mid-zoom; the cost of always re-rendering on parent reference churn is
// not worth that edge case.
const CardImage = memo(
    CardImageImpl,
    (prev, next) => getDefId(prev.card) === getDefId(next.card)
);
export default CardImage;
