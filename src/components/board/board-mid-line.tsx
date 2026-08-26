/** The mid-board line (ADR 0103 §1, issue #2727) — the hairline that separates
 *  the two halves of the table, warming to `signal-opponent` while an attack is
 *  live.
 *
 *  **It is drawn, not reserved.** Before this component the midline existed only
 *  as arithmetic: `PORTRAIT_MIDLINE_VAR` / `LANDSCAPE_MIDLINE_VAR` are the
 *  boundary the two battlefield bands tile against, and nothing ever painted it
 *  (`board-portrait-chips.tsx` says as much where the stack chip follows the
 *  same var). So this node had to be ADDED — and the one thing it must never do
 *  is cost a band anything. It is therefore `position: absolute` inside
 *  `data-board-root` (itself `absolute inset-0`), which takes it out of flow
 *  entirely: it is not a flex child, it reserves no height, and every band
 *  budget in `portrait-board-bands.ts` / `landscape-board-bands.ts` computes to
 *  exactly the same value with it mounted as without. `pointer-events-none`
 *  extends the same guarantee to hit-testing — a 1px strip across the middle of
 *  the board sits directly over the front row of both battlefields, and the
 *  #1760 bug class is chrome that swallows a tap meant for a permanent.
 *
 *  It reads the SAME custom property each viewport mode's bands are tiled
 *  against rather than re-deriving a position, so it cannot drift from the
 *  boundary it is drawing: portrait `--portrait-midline`, landscape-compact
 *  `--landscape-midline`, desktop the flat 50% its two `h-[32%]` bands meet at
 *  (`board-surface.tsx`). `-translate-y-1/2` centres the 1px rule ON that
 *  boundary instead of hanging it below.
 *
 *  Mounted FIRST among the board root's children so it paints beneath every
 *  card and every piece of chrome — it carries no z-index of its own, which is
 *  what keeps it out of the `z-chip` / `z-stack` / `z-modal` tiering the rest of
 *  the board negotiates. */
export default function BoardMidLine({
    isPortrait,
    landscapeCompact,
    hot,
}: {
    isPortrait: boolean;
    landscapeCompact: boolean;
    /** CR 508 — an attack is being declared or is under way, so the line reads
     *  as the front the attackers are crossing. Derived by the caller from the
     *  projected combat state (`isCombatLineHot`, `~/lib/board-chrome-v4`). */
    hot: boolean;
}) {
    // Landscape insets to the same rails its battlefield band uses
    // (LANDSCAPE_VIEWER_BATTLEFIELD_BAND), so the rule never runs under the
    // seat gutter or the pile/control rail. Portrait and desktop inset by a
    // proportional 6% instead: both halves are full-bleed there, and a rule
    // that reaches the very edge reads as a border on the viewport rather than
    // a line on the table.
    const position = isPortrait
        ? "top-[var(--portrait-midline)] left-[6%] right-[6%]"
        : landscapeCompact
          ? "top-[var(--landscape-midline)] left-[var(--landscape-side-gutter)] right-[var(--landscape-right-rail)]"
          : "top-1/2 left-[6%] right-[6%]";

    return (
        <div
            data-board-mid-line
            data-hot={hot || undefined}
            aria-hidden
            className={`pointer-events-none absolute h-px -translate-y-1/2 bg-gradient-to-r from-transparent to-transparent transition-colors duration-300 ${position} ${
                hot
                    ? "via-signal-opponent shadow-[0_0_14px_2px_color-mix(in_srgb,var(--color-signal-opponent)_45%,transparent)]"
                    : "via-[var(--hairline-strong)]"
            }`}
        />
    );
}
