/** Monarch badge shown under the player name in {@link PlayerNameplate}.
 *  CR 720 — the Monarch designation. Rendered only while this player IS the
 *  monarch. Uses a crown glyph inline as an SVG, in the semantic `accent`
 *  token (ADR 0007 — no chromatic Tailwind). Mirrors
 *  {@link PlayerPoisonCounters} / {@link PlayerEnergyCounters} structurally,
 *  but is a boolean flag (at most one monarch at a time) rather than a count
 *  (issue #1199). */
type PlayerMonarchBadgeProps = {
    /** True while this player is the monarch (`GameState.monarchId ===
     *  player.id`, CR 720.1). Hides the badge when false/undefined. */
    isMonarch: boolean | undefined;
};

export default function PlayerMonarchBadge({
    isMonarch,
}: PlayerMonarchBadgeProps) {
    if (!isMonarch) return null;

    return (
        <div
            className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold leading-none text-accent-strong"
            title="Monarch — draws a card at the beginning of their end step; combat damage to them steals the crown (CR 720)"
            aria-label="Monarch"
        >
            <CrownGlyph />
            <span className="uppercase tracking-[0.15em]">Monarch</span>
        </div>
    );
}

/** The crown glyph — a three-point crown, the traditional Monarch symbol
 *  (CR 720, Throne of Eldraine). `currentColor` so it inherits the
 *  surrounding `text-accent-strong`. */
function CrownGlyph() {
    return (
        <svg
            viewBox="0 0 16 16"
            width="11"
            height="11"
            role="img"
            aria-hidden="true"
            fill="none"
        >
            <path
                d="M2 12.5h12l-1-6-3 2.5-2-4-2 4-3-2.5-1 6Z"
                fill="currentColor"
                opacity="0.85"
                stroke="currentColor"
                strokeWidth="0.8"
                strokeLinejoin="round"
            />
        </svg>
    );
}
