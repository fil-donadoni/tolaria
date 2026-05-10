import CardImage from "~/components/cards/card-image";
import type { CardIndexEntry } from "./useCardSearch";

interface ResultsGridProps {
    entries: CardIndexEntry[] | undefined;
    /** True when no filter is set — show prompt instead of cards. */
    idle: boolean;
    onAdd: (cardId: string, cardName: string) => void;
}

export default function ResultsGrid({
    entries,
    idle,
    onAdd,
}: ResultsGridProps) {
    if (entries === undefined) {
        return (
            <div className="flex h-full items-center justify-center text-sm text-white/40">
                Loading card library…
            </div>
        );
    }

    if (idle) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-sm text-white/40">
                <p>Search or pick a filter to see cards.</p>
                <p className="text-xs text-white/30">
                    Name, color, type, or mana value all narrow the list.
                </p>
            </div>
        );
    }

    if (entries.length === 0) {
        return (
            <div className="flex h-full items-center justify-center text-sm text-white/40">
                No cards match these filters.
            </div>
        );
    }

    return (
        <div className="flex flex-wrap gap-3 p-2">
            {entries.map((entry) => (
                <button
                    key={entry.cardId}
                    onClick={() => onAdd(entry.cardId, entry.name)}
                    className="group relative w-[var(--card-w-sm)] shrink-0 transition hover:scale-[1.03]"
                    title={`Add ${entry.name}`}
                >
                    <div className="aspect-5/7 w-full">
                        <CardImage card={{ id: entry.cardId }} />
                    </div>
                    <div className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-transparent group-hover:ring-emerald-400/60" />
                </button>
            ))}
        </div>
    );
}
