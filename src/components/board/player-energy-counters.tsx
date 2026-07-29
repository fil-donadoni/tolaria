/** Energy counters badge shown under the player name in {@link PlayerNameplate}.
 *  CR 122.1 — energy is a player-owned resource counter (a player "gets {E}"
 *  and "pays {E}"). Rendered only when the count is greater than zero. Uses the
 *  official energy glyph (the lightning-bolt-in-a-frame {E} symbol) inline as an
 *  SVG, in the semantic `accent` token (ADR 0007 — no chromatic Tailwind).
 *  Mirrors {@link PlayerPoisonCounters} (issue #697). */
type PlayerEnergyCountersProps = {
    /** Energy counters on the player. Absent / zero hides the badge. */
    count: number | undefined;
    /** Portrait compact nameplate (#1814 round-2 fixup) — mirrors
     *  {@link PlayerPoisonCounters}'s `compact`: renders inline in the SAME
     *  row as life/name/poison, no own `mt-0.5`, spacing from the parent
     *  row's `gap` instead. */
    compact?: boolean;
};

export default function PlayerEnergyCounters({
    count,
    compact = false,
}: PlayerEnergyCountersProps) {
    if (!count || count <= 0) return null;

    return (
        <div
            className={`${compact ? "" : "mt-0.5"} inline-flex items-center gap-1 text-[11px] font-semibold leading-none text-accent-strong`}
            title={`${count} energy counter${count === 1 ? "" : "s"} ({E})`}
            aria-label={`${count} energy counters`}
        >
            <EnergyGlyph />
            <span className="tabular-nums">{count}</span>
        </div>
    );
}

/** The energy glyph — a lightning bolt, the symbol MTG prints for the {E}
 *  energy counter. `currentColor` so it inherits the surrounding
 *  `text-accent-strong`. */
function EnergyGlyph() {
    return (
        <svg
            viewBox="0 0 16 16"
            width="11"
            height="11"
            role="img"
            aria-hidden="true"
            fill="none"
        >
            {/* Lightning bolt (CR 122.1 energy {E} symbol). */}
            <path
                d="M9 1.5 3.5 9h3.2l-.7 5.5L12.5 7H9.3L9 1.5Z"
                fill="currentColor"
                opacity="0.85"
                stroke="currentColor"
                strokeWidth="0.8"
                strokeLinejoin="round"
            />
        </svg>
    );
}
