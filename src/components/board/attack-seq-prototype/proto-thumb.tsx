// PROTOTYPE (issue #9500) — a sized real CardImage (hover preview included).
import CardImage from "~/components/cards/card-image";
import type { CardInstance } from "~/types/game";

export default function ProtoThumb({
    card,
    width,
    className = "",
}: {
    card: CardInstance;
    width: number;
    className?: string;
}) {
    return (
        <div
            className={`relative shrink-0 overflow-hidden rounded-[6%] ${className}`}
            style={{ width, height: width * 1.395 }}
        >
            <CardImage card={card} sizes={`${width}px`} includeThumb />
        </div>
    );
}
