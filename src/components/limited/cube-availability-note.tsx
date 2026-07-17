import type { DraftableSetInfo } from "~/hooks/useLimitedEvent";

interface CubeAvailabilityNoteProps {
    /** The currently-selected Pack Source's Draftability info, or `undefined`
     *  while nothing is selectable yet. */
    set: DraftableSetInfo | undefined;
}

/** Cube availability note (ADR 0062): shown under the Pack Source selector
 *  when the Vintage Cube is the chosen source — a positive "N cards available"
 *  disclosure, NOT the Incompleteness "N missing" disable a real set gets. A
 *  cube is a curated pool, not a set to complete: there is no completeness bar
 *  to fall short of, so the note is informational only. Renders nothing for a
 *  real set or while no source is selected. */
export default function CubeAvailabilityNote({
    set,
}: CubeAvailabilityNoteProps) {
    if (!set || !set.isCube) return null;
    const count = set.availableCardCount ?? 0;

    return (
        <p
            role="status"
            className="rounded-sm border border-accent/40 bg-accent-soft/40 px-2 py-1.5 text-xs text-text"
        >
            <span className="font-semibold uppercase tracking-wide text-accent-strong">
                Vintage Cube
            </span>
            {" — "}
            {count} card{count === 1 ? "" : "s"} available. A cube is a curated
            pool shuffled into random 15-card packs (no set-completeness gate).
            Packs are singleton when the pool is large enough, topped up
            otherwise. Draft only.
        </p>
    );
}
