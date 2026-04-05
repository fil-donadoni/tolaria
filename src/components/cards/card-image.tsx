import { getImageUrl } from "~/lib/images";
import type { Card } from "~/types/cards";
import CardPreview from "./card-preview";

export default function CardImage({ card }: { card: Card }) {
    return (
        <CardPreview cardId={card.id} cardName={card.name}>
            <img
                src={getImageUrl(card.id)}
                className="rounded-md"
                alt={card.name}
            />
        </CardPreview>
    );
}
