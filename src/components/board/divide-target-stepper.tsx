/** `[−] N [+]` dial for divide-as-you-choose damage (CR 601.2d, ADR 0007
 *  semantic tokens). Rendered inline in the divide dialog beneath each legal
 *  target (Pyrokinesis / Fire Covenant): the player sets each target's share
 *  independently. `stopPropagation` so a tap on the dial never falls through to
 *  the dialog's drag handler. */
export default function DivideTargetStepper({
    n,
    canMinus,
    canPlus,
    onMinus,
    onPlus,
}: {
    n: number;
    canMinus: boolean;
    canPlus: boolean;
    onMinus: () => void;
    onPlus: () => void;
}) {
    const btn =
        "w-6 h-6 rounded-full text-sm font-beleren bg-accent-soft border border-accent text-accent-strong hover:bg-accent-soft/80 disabled:opacity-35 disabled:cursor-not-allowed transition-colors cursor-pointer leading-none";
    const stop = (fn: () => void) => (e: React.MouseEvent) => {
        e.stopPropagation();
        fn();
    };
    return (
        <div
            className="flex items-center gap-1.5 bg-surface-2 border border-border-subtle rounded-full px-1.5 py-1 shadow-[0_6px_16px_rgba(0,0,0,0.5)]"
            onClick={(e) => e.stopPropagation()}
        >
            <button
                type="button"
                className={btn}
                disabled={!canMinus}
                onClick={stop(onMinus)}
                aria-label="Assign one less"
            >
                −
            </button>
            <span className="min-w-5 text-center font-beleren text-parchment tabular-nums">
                {n}
            </span>
            <button
                type="button"
                className={btn}
                disabled={!canPlus}
                onClick={stop(onPlus)}
                aria-label="Assign one more"
            >
                +
            </button>
        </div>
    );
}
