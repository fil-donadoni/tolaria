import type { ReactNode } from "react";
import type { ScopeCardProfile } from "~/hooks/useCardProfiles";
import CardProfilesSweepTile from "./card-profiles-sweep-tile";
import { SWEEP_LANE_LABEL, type SweepLane } from "./card-profiles-sweep-model";

interface CardProfilesSweepLaneProps {
    lane: SweepLane;
    cards: ScopeCardProfile[];
    rowLabel: string;
    onToggleTag: (card: ScopeCardProfile) => void;
    onConfirm?: (card: ScopeCardProfile) => void;
    /** The lane's bulk action, under its heading ("Confirm all proposed"). */
    action?: ReactNode;
    disabled: boolean;
}

const LANE_TONE: Record<SweepLane, string> = {
    reviewed: "text-success-strong",
    proposed: "text-danger-strong",
    untagged: "text-text-muted",
};

/** One lane of the sweep board: a labelled region of tiles. A card in the
 *  reviewed or proposed lane carries the row; one in Not tagged does not. */
export default function CardProfilesSweepLane({
    lane,
    cards,
    rowLabel,
    onToggleTag,
    onConfirm,
    action,
    disabled,
}: CardProfilesSweepLaneProps) {
    const label = SWEEP_LANE_LABEL[lane];
    return (
        <section
            aria-label={label}
            className="flex min-w-0 flex-col gap-2 rounded-md border border-border-subtle/30 p-3"
        >
            <h3 className="flex items-baseline justify-between gap-2 text-sm">
                <span className={LANE_TONE[lane]}>{label}</span>
                <span className="text-xs text-text-muted">{cards.length}</span>
            </h3>
            {action}
            {cards.length === 0 ? (
                <p className="text-xs text-text-muted">No cards.</p>
            ) : (
                <ul className="grid max-h-[60vh] grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2 overflow-y-auto pr-1">
                    {cards.map((card) => (
                        <CardProfilesSweepTile
                            key={card.cardId}
                            card={card}
                            rowLabel={rowLabel}
                            tagged={lane !== "untagged"}
                            onToggleTag={() => onToggleTag(card)}
                            onConfirm={
                                onConfirm ? () => onConfirm(card) : undefined
                            }
                            disabled={disabled}
                        />
                    ))}
                </ul>
            )}
        </section>
    );
}
