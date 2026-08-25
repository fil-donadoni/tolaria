/** Experience counters badge shown under the player name in
 *  {@link PlayerNameplate}. CR 122.1 — "A counter is a marker placed on an
 *  object or player"; experience counters sit on the PLAYER, are never removed
 *  by any rule, and survive the permanent that granted them leaving the
 *  battlefield (CR 122.2's zone-change loss is object-scoped). Rendered only
 *  when the count is greater than zero. Uses the official experience-counter
 *  glyph (the chevron/star medal MTG prints on the Commander 2015 experience
 *  token) inline as an SVG, in the semantic `accent` token (ADR 0007 — no
 *  chromatic Tailwind). Mirrors {@link PlayerPoisonCounters} and
 *  {@link PlayerEnergyCounters} (issue #1969). */
type PlayerExperienceCountersProps = {
    /** Experience counters on the player. Absent / zero hides the badge. */
    count: number | undefined;
    /** Portrait / landscape compact nameplate — mirrors
     *  {@link PlayerPoisonCounters}'s `compact`: renders inline in the SAME
     *  row as life/name/poison/energy, no own `mt-0.5`, spacing from the parent
     *  row's `gap` instead. */
    compact?: boolean;
};

export default function PlayerExperienceCounters({
    count,
    compact = false,
}: PlayerExperienceCountersProps) {
    if (!count || count <= 0) return null;

    return (
        <div
            className={`${compact ? "" : "mt-0.5"} inline-flex items-center gap-1 text-[11px] font-semibold leading-none text-accent`}
            title={`${count} experience counter${count === 1 ? "" : "s"}`}
            aria-label={`${count} experience counters`}
        >
            <ExperienceGlyph />
            <span className="tabular-nums">{count}</span>
        </div>
    );
}

/** The experience glyph — a laurel-flanked chevron, the mark MTG prints on the
 *  experience counter token. `currentColor` so it inherits the surrounding
 *  `text-accent`. */
function ExperienceGlyph() {
    return (
        <svg
            viewBox="0 0 16 16"
            width="11"
            height="11"
            role="img"
            aria-hidden="true"
            fill="none"
        >
            {/* Medallion outline (CR 122.1 experience counter). */}
            <circle
                cx="8"
                cy="8"
                r="6.2"
                fill="currentColor"
                opacity="0.22"
                stroke="currentColor"
                strokeWidth="1.2"
            />
            {/* Chevron mark inside the medallion. */}
            <path
                d="M4.8 8.6 8 5.2l3.2 3.4M4.8 11.2 8 7.8l3.2 3.4"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}
