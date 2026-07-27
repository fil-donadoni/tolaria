import { useMemo, useState } from "react";
import { Input } from "~/components/ui/input";
import type {
    EditableCardProfile,
    ScopeCardProfile,
} from "~/hooks/useCardProfiles";
import CardProfileCardRow from "./card-profile-card-row";

interface CardProfileEditorProps {
    /** The chosen scope's cards with both profile layers — the exact wire
     *  shape `listScopeCardProfilesForEditor` returns. `undefined` while the
     *  query is still loading. Passed in by the caller so this component
     *  stays a pure presentational renderer, directly unit-testable with the
     *  real query's wire shape and no Convex client (mirrors
     *  `PickRatingEditor`). */
    cards: ScopeCardProfile[] | undefined;
    /** Fires `setCardProfile(scope, cardId, …)` for one card — the caller
     *  owns scope threading. */
    onSave: (cardId: string, profile: EditableCardProfile) => Promise<unknown>;
    /** Fires `clearCardProfile(scope, cardId)` for one card. */
    onClear: (cardId: string) => Promise<unknown>;
}

/** Searchable card list + inline Card Profile editor for the currently
 *  chosen scope (PRD #1607, ADR 0072, issue #1614). Beyond the name search
 *  it offers one extra filter the Pick Rating editor has no use for: "Only
 *  unreviewed" — the census lands every row `reviewed: false`, so the
 *  reviewer's actual workflow is "show me what still needs confirming", and
 *  without it the queue is invisible inside a several-hundred-card list. */
export default function CardProfileEditor({
    cards,
    onSave,
    onClear,
}: CardProfileEditorProps) {
    const [search, setSearch] = useState("");
    const [unreviewedOnly, setUnreviewedOnly] = useState(false);

    const filtered = useMemo(() => {
        if (!cards) return undefined;
        const query = search.trim().toLowerCase();
        return cards.filter((card) => {
            if (query && !card.name.toLowerCase().includes(query)) return false;
            if (!unreviewedOnly) return true;
            const effective = card.dbProfile ?? card.seedProfile;
            return effective !== null && !effective.reviewed;
        });
    }, [cards, search, unreviewedOnly]);

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-3">
                <Input
                    type="text"
                    placeholder="Search cards…"
                    aria-label="Search cards"
                    value={search}
                    onChange={(e) => setSearch(e.currentTarget.value)}
                />
                <label className="flex shrink-0 items-center gap-1 text-[11px] text-text">
                    <input
                        type="checkbox"
                        checked={unreviewedOnly}
                        aria-label="Only unreviewed"
                        onChange={(e) =>
                            setUnreviewedOnly(e.currentTarget.checked)
                        }
                    />
                    Only unreviewed
                </label>
            </div>
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
                            No cards match your filters.
                        </p>
                    )}
                <div className="flex flex-col gap-1">
                    {filtered?.map((card) => (
                        <CardProfileCardRow
                            key={card.cardId}
                            card={card}
                            onSave={(profile) => onSave(card.cardId, profile)}
                            onClear={() => onClear(card.cardId)}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}
