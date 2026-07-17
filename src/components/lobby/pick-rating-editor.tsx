import { useMemo, useState } from "react";
import { Input } from "~/components/ui/input";
import type { ScopeCardRating } from "~/hooks/useCardRatings";
import PickRatingCardRow from "./pick-rating-card-row";

interface PickRatingEditorProps {
    /** The chosen scope's cards with both rating layers — the exact wire
     *  shape `listScopeCardRatings` returns. `undefined` while the query is
     *  still loading. Passed in by the caller (mirrors
     *  `limited-events-page.tsx` handing `draftableSets` down to
     *  `CreateLimitedEventDialog`) so this component stays a pure
     *  presentational renderer, directly unit-testable with the real query's
     *  wire shape and no Convex client. */
    cards: ScopeCardRating[] | undefined;
    /** Fires `setCardRating(scope, cardId, rating)` for one card — the
     *  caller owns scope threading. Rejected promise surfaces as an inline
     *  error on that card's row. Return value is ignored. */
    onSave: (cardId: string, rating: number) => Promise<unknown>;
    /** Fires `clearCardRating(scope, cardId)` for one card. */
    onClear: (cardId: string) => Promise<unknown>;
}

/** Searchable card list + inline rating editor for the currently chosen
 *  scope (PRD #1296 Slice C, issue #1300). Renders every card's effective
 *  rating (a database override, or the checked-in seed default) via
 *  `PickRatingCardRow`, and threads per-card save/clear through to the
 *  caller-owned mutations. */
export default function PickRatingEditor({
    cards,
    onSave,
    onClear,
}: PickRatingEditorProps) {
    const [search, setSearch] = useState("");

    const filtered = useMemo(() => {
        if (!cards) return undefined;
        const query = search.trim().toLowerCase();
        if (!query) return cards;
        return cards.filter((c) => c.name.toLowerCase().includes(query));
    }, [cards, search]);

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
            <Input
                type="text"
                placeholder="Search cards…"
                aria-label="Search cards"
                value={search}
                onChange={(e) => setSearch(e.currentTarget.value)}
            />
            <div className="min-h-0 flex-1 overflow-auto">
                {cards === undefined && (
                    <p className="text-xs text-text-muted">Loading…</p>
                )}
                {cards !== undefined && cards.length === 0 && (
                    <p className="text-xs text-text-muted">
                        No cards for this scope yet.
                    </p>
                )}
                {cards !== undefined &&
                    cards.length > 0 &&
                    filtered !== undefined &&
                    filtered.length === 0 && (
                        <p className="text-xs text-text-muted">
                            No cards match your search.
                        </p>
                    )}
                <div className="flex flex-col gap-1">
                    {filtered?.map((card) => (
                        <PickRatingCardRow
                            key={card.cardId}
                            card={card}
                            onSave={(rating) => onSave(card.cardId, rating)}
                            onClear={() => onClear(card.cardId)}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}
