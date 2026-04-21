import { memo } from "react";
import { getImageUrl } from "~/lib/images";
import { getCardById } from "@convex/cards";
import CardPreview from "./card-preview";

// `contain: paint` + promoted layer keep Chrome's compositor from shipping
// the bitmap as a low-res tile while ancestors are transitioning/rotating.
const STABLE_LAYER: React.CSSProperties = {
    contain: "paint",
    transform: "translateZ(0)",
    willChange: "transform",
    backfaceVisibility: "hidden",
};

function CardImageImpl({ card }: { card: { id: string } }) {
    const name = getCardById(card.id).name;
    return (
        <CardPreview cardId={card.id} cardName={name}>
            <div
                className="relative w-full h-full rounded-sm overflow-hidden"
                style={STABLE_LAYER}
            >
                <img
                    src={getImageUrl(card.id)}
                    className="w-full h-full object-cover block"
                    alt={name}
                    decoding="async"
                    draggable={false}
                />
            </div>
        </CardPreview>
    );
}

const CardImage = memo(
    CardImageImpl,
    (prev, next) => prev.card.id === next.card.id
);
export default CardImage;
