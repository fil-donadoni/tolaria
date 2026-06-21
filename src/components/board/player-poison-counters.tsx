/** Poison counters badge shown under the player name in {@link PlayerNameplate}.
 *  CR 122 (counters on a player) / CR 704.5c (ten or more loses). Rendered only
 *  when the count is greater than zero. Uses the official poison glyph (the
 *  Phyrexian-style toxic droplet, as on New Phyrexia poison cards) inline as an
 *  SVG, in the semantic `danger` token (ADR 0007 — no chromatic Tailwind). */
type PlayerPoisonCountersProps = {
    /** Poison counters on the player. Absent / zero hides the badge. */
    count: number | undefined;
};

export default function PlayerPoisonCounters({
    count,
}: PlayerPoisonCountersProps) {
    if (!count || count <= 0) return null;

    return (
        <div
            className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold leading-none text-danger-strong"
            title={`${count} poison counter${count === 1 ? "" : "s"} (lose at 10)`}
            aria-label={`${count} poison counters`}
        >
            <PoisonGlyph />
            <span className="tabular-nums">{count}</span>
        </div>
    );
}

/** The toxic droplet glyph — a downward droplet enclosing the Phyrexian "Φ"
 *  cross, the symbol MTG prints for poison/toxic. `currentColor` so it inherits
 *  the surrounding `text-danger-strong`. */
function PoisonGlyph() {
    return (
        <svg
            viewBox="0 0 16 16"
            width="11"
            height="11"
            role="img"
            aria-hidden="true"
            fill="none"
        >
            {/* Droplet outline (CR poison/toxic teardrop). */}
            <path
                d="M8 1.5c2.4 3 5 5.6 5 8.3a5 5 0 0 1-10 0c0-2.7 2.6-5.3 5-8.3Z"
                fill="currentColor"
                opacity="0.22"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
            />
            {/* Phyrexian cross inside the droplet. */}
            <path
                d="M8 6.4v5M6 9.4h4"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
            />
        </svg>
    );
}
