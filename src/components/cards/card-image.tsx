import { getImageUrl } from "~/lib/images";
import { getCardById } from "@convex/cards";
import CardPreview from "./card-preview";

export default function CardImage({ card }: { card: { id: string } }) {
    const name = getCardById(card.id).name;
    return (
        <CardPreview cardId={card.id} cardName={name}>
            <img
                src={getImageUrl(card.id)}
                className="rounded-sm w-full h-full object-cover block"
                alt={name}
            />
        </CardPreview>
    );
}
