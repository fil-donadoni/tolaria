// PROTOTYPE — throwaway. A fanned, overlapping strip of picked cards (the
// draft room's Pool / Sideboard), its own horizontal scroller.
import type { ProtoCard } from "../proto-cards";
import DraftMiniCard from "./draft-mini-card";

export default function DraftStrip({
    title,
    cards,
    onCardClick,
}: {
    title: string;
    cards: ProtoCard[];
    onCardClick: (card: ProtoCard, el: Element, src: string) => void;
}) {
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-disabled">
                {title} · {cards.length}
            </span>
            <div
                data-hscroll
                className="flex min-h-[86px] items-start overflow-x-auto rounded-sm border border-border-subtle/40 bg-surface-elevated/20 p-1.5 pr-6 [scrollbar-width:thin]"
            >
                {cards.length === 0 && (
                    <span className="m-auto text-[11px] text-text-disabled">
                        Picks land here
                    </span>
                )}
                {cards.map((c, i) => (
                    <DraftMiniCard
                        key={c.name}
                        card={c}
                        onClick={onCardClick}
                        className={i === 0 ? "w-14" : "-ml-7 w-14"}
                    />
                ))}
            </div>
        </div>
    );
}
