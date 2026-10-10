// PROTOTYPE — throwaway. One card in a pile: printed image, absolutely
// placed at its stack offset (`--peek` per card above it), lifts on hover.
// `data-fly-key` is what the FLIP fly lands on.
import { getPrintedCardImageUrl } from "~/lib/images";
import type { ProtoCard } from "../proto-cards";

export default function PileCard({
    card,
    index,
    onClick,
}: {
    card: ProtoCard;
    index: number;
    onClick: (card: ProtoCard, el: Element) => void;
}) {
    return (
        <button
            type="button"
            data-fly-key={card.name}
            onClick={(e) => onClick(card, e.currentTarget)}
            title={card.name}
            aria-label={card.name}
            className="absolute left-0 w-(--cw) overflow-hidden rounded-[calc(var(--cw)*0.048)] shadow-[0_2px_6px_rgba(0,0,0,0.55)] outline-none z-(--z) transition-transform duration-150 hover:z-40 hover:-translate-y-1.5 focus-visible:z-40 focus-visible:ring-2 focus-visible:ring-accent"
            style={{
                top: `calc(${index} * var(--peek))`,
                ["--z" as string]: index,
                aspectRatio: "488 / 680",
            }}
        >
            <img
                src={getPrintedCardImageUrl(card.id)}
                alt=""
                loading="lazy"
                draggable={false}
                className="size-full object-cover"
            />
        </button>
    );
}
