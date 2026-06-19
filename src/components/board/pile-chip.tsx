type PileChipProps = {
    /** Short zone label, e.g. "GY", "LIB", "EXL", "STACK". */
    label: string;
    /** Card count shown beside the label. */
    count: number;
    onClick: () => void;
    "data-testid"?: string;
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
}: PileChipProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            data-testid={testId}
            className="flex items-center gap-1 rounded-md border border-zinc-700/70 bg-white/[0.06] px-2 py-1 font-beleren text-[10px] text-white/85 active:bg-white/[0.12]"
        >
            {label}
            <span className="font-bold text-amber-300">{count}</span>
        </button>
    );
}
