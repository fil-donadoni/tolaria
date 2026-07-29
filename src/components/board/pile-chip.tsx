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
    /** Compact rendering for the controller bottom bar's inline zone-chip
     *  cell (#1815 review fixup). The default variant's `min-w-14` WIDTH
     *  floor (#1770) is sized for a chip that owns its own board real
     *  estate; three of them side by side no longer fit that way inside a
     *  single quarter-width bar cell (~97px at a 390px viewport). Compact
     *  mode drops the width floor and lets `flex-1` share the cell's actual
     *  width evenly instead — it stays correct at any viewport because it
     *  never hardcodes a px value. The `min-h-11` HEIGHT floor is KEPT: the
     *  touch target's generous axis comes from the bar row itself (already
     *  taller than 44px), not from this chip needing to be square. */
    compact?: boolean;
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
    compact = false,
}: PileChipProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            data-testid={testId}
            data-arrow-anchor-graveyard={arrowAnchorGraveyard}
            className={
                compact
                    ? // See the `compact` doc comment above: no `min-w-14`,
                      // `flex-1 min-w-0` instead so N compact chips split
                      // their flex container's real width evenly.
                      "flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0 rounded-md border border-border-subtle bg-surface-elevated px-0.5 py-0.5 font-beleren text-[8px] leading-tight text-text-muted active:bg-surface"
                    : // `min-h-11 min-w-14` (#1770 mobile QA sweep touch-target
                      // audit): the chip's own label + count text sat well
                      // under the 44px floor (~py-1 + a 10px line ≈ 24-26px
                      // tall). A floor, not a fixed size, so a longer
                      // count/label keeps growing outward.
                      "flex min-h-11 min-w-14 items-center justify-center gap-1 rounded-md border border-border-subtle bg-surface-elevated px-2 py-1 font-beleren text-[10px] text-text-muted active:bg-surface"
            }
        >
            {compact ? (
                <>
                    <span>{label}</span>
                    <span className="font-bold text-accent-strong">
                        {count}
                    </span>
                </>
            ) : (
                <>
                    {label}
                    <span className="font-bold text-accent-strong">
                        {count}
                    </span>
                </>
            )}
        </button>
    );
}
