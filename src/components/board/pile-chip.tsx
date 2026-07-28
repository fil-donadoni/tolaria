type PileChipProps = {
    /** Short zone label, e.g. "GY", "LIB", "EXL", "STACK". */
    label: string;
    /** Card count shown beside the label. */
    count: number;
    onClick: () => void;
    "data-testid"?: string;
    /** Player id to anchor graveyard-card target arrows (Regrowth, Raise Dead,
     *  Animate Dead) to. BoardPileChips mounts the real `PlayerGraveyard` (the
     *  attribute's other source) inside a `hidden` wrapper, so its rect is
     *  always degenerate on portrait — this chip is the one VISIBLE element
     *  carrying the anchor there. */
    "data-arrow-anchor-graveyard"?: string;
};

/** A tappable zone chip for the portrait board (#336). On a narrow viewport the
 *  space-eating card-pile columns collapse into a row of these chips: each shows
 *  a zone label + count and, when tapped, opens the EXISTING reveal / stack view
 *  (the chip is only the trigger — the dialog surface is reused unchanged). View
 *  layer only. */
export default function PileChip({
    label,
    count,
    onClick,
    "data-testid": testId,
    "data-arrow-anchor-graveyard": arrowAnchorGraveyard,
}: PileChipProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            data-testid={testId}
            data-arrow-anchor-graveyard={arrowAnchorGraveyard}
            className="flex items-center gap-1 rounded-md border border-border-subtle bg-surface-elevated px-2 py-1 font-beleren text-[10px] text-text-muted active:bg-surface"
        >
            {label}
            <span className="font-bold text-accent-strong">{count}</span>
        </button>
    );
}
