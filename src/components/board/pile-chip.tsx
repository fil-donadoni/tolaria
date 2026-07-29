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
     *  cell (#1815 review fixup; widened in review fixup round 2). The
     *  touch-target floor (WCAG SC 2.5.8) is governed by the SMALLER of an
     *  element's two axes — for three chips splitting one bar cell, that
     *  smaller axis is WIDTH, not height, so height alone being tall never
     *  satisfied the 44px requirement. Round 1 dropped the default variant's
     *  `min-w-14` (56px, sized for a chip owning its own board real estate)
     *  down to `min-w-0` and relied on the cell being wide enough to give
     *  `flex-1` a ≥44px share — but the cell was ONE quarter-width bar column
     *  (~97px at 390px, ~80px at 320px), so 3-way division landed at
     *  23-29px, under floor on BOTH the #1770 44px target and even the raw
     *  24px WCAG minimum. Round 2 fixes this at both ends: the bar cell
     *  itself is now DOUBLE-WIDTH (`controller-bottom-bar.tsx`'s
     *  `grid-cols-6` + `col-span-3`, ~half the bar), giving `flex-1` real
     *  room (≈48-65px/chip across 320-390px) — AND this chip keeps an
     *  explicit `min-w-11` (44px) floor of its own, so the guarantee doesn't
     *  depend on the cell math staying exactly right forever: if the cell
     *  ever narrows again, the chips overflow their row rather than
     *  silently shrinking under 44px. The `min-h-11` HEIGHT floor is
     *  unchanged — the bar row is already taller than 44px, so only width
     *  needed the new explicit floor. */
    compact?: boolean;
    /** Bar-cell width sharing (#1867): `flex-1` so the three chips split the
     *  controller bar's double-width "Zones" cell evenly. Only meaningful in
     *  that horizontal flex-row context — the opponent's VERTICAL top-right
     *  column (`vertical` on `BoardPileChips`) omits it, where a grow factor
     *  on the column axis would be inert-but-fragile (it would start
     *  stretching chip heights the moment the column ever gets a constrained
     *  height). */
    grow?: boolean;
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
    grow = false,
}: PileChipProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            data-testid={testId}
            data-arrow-anchor-graveyard={arrowAnchorGraveyard}
            className={
                compact
                    ? // See the `compact` doc comment above: `grow` (flex-1,
                      // bar cell only — see its doc) shares the double-width
                      // cell's real width evenly, and `min-w-11` (44px) is a
                      // hard floor of its own so the guarantee never depends
                      // solely on the cell staying wide enough.
                      `flex min-h-11 min-w-11 ${grow ? "flex-1 " : ""}flex-col items-center justify-center gap-0 rounded-md border border-border-subtle bg-surface-elevated px-0.5 py-0.5 font-beleren text-[10px] leading-tight text-text-muted active:bg-surface`
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
