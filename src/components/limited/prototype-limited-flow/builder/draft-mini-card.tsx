// PROTOTYPE — throwaway. A plain card button for the draft fly demo.
import { getPrintedCardImageUrl } from "~/lib/images";
import { cn } from "~/lib/utils";
import type { ProtoCard } from "../proto-cards";

export default function DraftMiniCard({
    card,
    onClick,
    className,
}: {
    card: ProtoCard;
    onClick: (card: ProtoCard, el: Element, src: string) => void;
    className?: string;
}) {
    const src = getPrintedCardImageUrl(card.id);
    return (
        <button
            type="button"
            data-fly-key={`draft:${card.name}`}
            title={card.name}
            aria-label={card.name}
            onClick={(e) => onClick(card, e.currentTarget, src)}
            className={cn(
                "shrink-0 overflow-hidden rounded-[5%/3.6%] shadow-[0_2px_6px_rgba(0,0,0,0.5)] transition-transform hover:z-10 hover:-translate-y-1",
                className
            )}
            style={{ aspectRatio: "488 / 680" }}
        >
            <img
                src={src}
                alt=""
                draggable={false}
                className="size-full object-cover"
            />
        </button>
    );
}
