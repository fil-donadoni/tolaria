import { getImageUrl } from "~/lib/images";
import type { Card } from "~/types/cards";

export default function CardImage({ card }: { card: Card }) {
    return (
        <img
            src={getImageUrl(card.id)}
            className="rounded-md"
            alt="Black Lotus"
        />
    );
}
