import { hasMaxSpeed } from "@convex/gre/speed";

type PlayerSpeedProps = {
    /** The player's speed (CR 702.179b). Absent hides the badge: having no
     *  speed is a different state from any number, and shows as nothing. */
    speed: number | undefined;
    /** Portrait compact nameplate — mirrors `PlayerPoisonCounters`' `compact`:
     *  inline in the same row, spacing from the parent row's `gap`. */
    compact?: boolean;
};

/** A player's speed under the name in `PlayerNameplate` (CR 702.179), naming
 *  max speed (CR 702.179e) because that is the value cards ask about. */
export default function PlayerSpeed({
    speed,
    compact = false,
}: PlayerSpeedProps) {
    if (!speed) return null;
    const label = hasMaxSpeed({ speed }) ? "Max speed" : `Speed ${speed}`;

    return (
        <div
            className={`${compact ? "" : "mt-0.5"} inline-flex items-center text-[11px] font-semibold leading-none text-accent-strong`}
            title={`${label} (raised once on each of your turns when an opponent loses life)`}
            aria-label={label}
            data-testid="player-speed"
        >
            <span className="tabular-nums">{label}</span>
        </div>
    );
}
