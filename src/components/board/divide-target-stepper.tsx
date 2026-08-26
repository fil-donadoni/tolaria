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
    // `w-11 h-11` (44px, #1770 mobile QA sweep touch-target audit): was
    // `w-6 h-6` (24px). Flex-centred rather than `leading-none` (which only
    // mattered for the old fixed height) so the glyph stays centred.
    //
    // v4 (ADR 0103 §3/§5, issue #2730): the dial was a fully bespoke recipe
    // (`bg-accent-soft`/`shadow-[...]` glow, `font-beleren` count) — quiet
    // hairline chrome instead: a hairline plate (same `--hairline`/`bg-surface`
    // pair as `V4_PLATE`, kept literal here rather than imported since the
    // shape is a pill, not `V4_PLATE`'s panel radius) with the count in the
    // chrome display face, never Beleren (confined to the card domain).
    const btn =
        "flex w-11 h-11 items-center justify-center rounded-full text-sm border border-[var(--hairline-strong)] bg-surface text-text-muted hover:border-accent hover:text-text disabled:opacity-35 disabled:cursor-not-allowed transition-colors cursor-pointer";
    const stop = (fn: () => void) => (e: React.MouseEvent) => {
        e.stopPropagation();
        fn();
    };
    return (
        <div
            className="flex items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-surface/85 px-1.5 py-1 backdrop-blur-md"
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
            <span className="text-display min-w-5 text-center text-text tabular-nums">
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
