import { useMemo, useState } from "react";
import { Input } from "~/components/ui/input";
import type {
    EditableCardProfile,
    ScopeCardProfile,
} from "~/hooks/useCardProfiles";
import CardProfileCardRow from "./card-profile-card-row";
import CardProfileReviewProgress from "./card-profile-review-progress";

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

/** The human review pass over one scope's Card Profiles (PRD #1607, ADR 0072,
 *  issues #1614 and #3597).
 *
 *  Shaped for the pass rather than for lookup (issue #3597): the task is "look
 *  at a card, decide, mark it reviewed, next" several hundred times, so this
 *  component owns the three things a list of rows cannot — PROGRESS against
 *  the scope (every census row lands `reviewed: false` and contributes at half
 *  weight until confirmed, so the remaining count is the pass's whole status),
 *  the unreviewed-only FILTER that is the queue itself, and WHICH row is open,
 *  which is what lets one row's save hand the queue to the next.
 *
 *  Single-open accordion, deliberately: two rows open at once makes "the next
 *  one" ambiguous, and the pass is strictly sequential. */
export default function CardProfileEditor({
    cards,
    onSave,
    onClear,
}: CardProfileEditorProps) {
    const [search, setSearch] = useState("");
    const [unreviewedOnly, setUnreviewedOnly] = useState(false);
    const [openCardId, setOpenCardId] = useState<string | null>(null);

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

    // Progress is measured over the WHOLE scope, never the filtered view: the
    // reviewer turns "Only unreviewed" on precisely to hide what is done, and
    // a denominator that shrank with it would always read 0%.
    const progress = useMemo(() => {
        let profiled = 0;
        let reviewed = 0;
        for (const card of cards ?? []) {
            const effective = card.dbProfile ?? card.seedProfile;
            if (effective === null) continue;
            profiled++;
            if (effective.reviewed) reviewed++;
        }
        return { profiled, reviewed };
    }, [cards]);

    /** Open the row AFTER `cardId` in the CURRENT filtered order, or close up
     *  when it was the last one. Resolved against the list as it stands at the
     *  moment of the save — the saved row is about to leave a filtered-to-
     *  unreviewed list, and the successor must be read before it does. */
    function advanceFrom(cardId: string) {
        const list = filtered ?? [];
        const index = list.findIndex((card) => card.cardId === cardId);
        const next = index === -1 ? undefined : list[index + 1];
        setOpenCardId(next ? next.cardId : null);
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
            <CardProfileReviewProgress
                reviewed={progress.reviewed}
                total={progress.profiled}
            />
            {/* The one clarification the vocabulary actually raises in use
                (issue #3597). Both registries spell out both directions in
                their row descriptions — which the pickers surface as tooltips
                — but neither says which DIRECTION the reviewer is being asked
                about, and an empty `requires` reads as an omission until
                somebody says it is the norm. */}
            <p className="text-[11px] leading-snug text-text-muted">
                <strong className="font-medium text-text">Provides</strong> is
                what this card OFFERS a partner;{" "}
                <strong className="font-medium text-text">Requires</strong> is
                what it NEEDS from one.{" "}
                <strong className="font-medium text-text">
                    An empty Requires is the norm
                </strong>{" "}
                — only reanimation spells, cheat-into-play effects,
                storm/metalcraft payoffs and graveyard-scaling costs require
                anything. Hover a checkbox for the registry's own definition.
            </p>
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
                            open={openCardId === card.cardId}
                            onToggle={() =>
                                setOpenCardId((prev) =>
                                    prev === card.cardId ? null : card.cardId
                                )
                            }
                            onSave={(profile) => onSave(card.cardId, profile)}
                            onClear={() => onClear(card.cardId)}
                            onAdvance={() => advanceFrom(card.cardId)}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}
