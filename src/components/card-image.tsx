import type { Card } from "@data/cards/types";
import { getImageUrl } from "~/lib/images";

export default function CardImage({ card }: { card: Card }) {
    return <img src={getImageUrl(card.id)} alt="Black Lotus" />;
}
