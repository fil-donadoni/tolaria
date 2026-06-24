import type { CardInstance } from "~/types/game";
import { isDepthPile } from "~/lib/board-layout";
import BattlefieldStackFan from "./battlefield-stack-fan";
import BattlefieldStackDepthPile from "./battlefield-stack-depth-pile";

type BattlefieldStackProps = {
    /** Ordered stack members (untapped first, then tapped — already sorted by
     *  `groupBattlefield`). Always ≥2 for a real stack; a length-1 array renders
     *  the lone member with no fan/badge. */
    members: CardInstance[];
    /** Renders ONE member as the existing battlefield card so tap rotation, P/T,
     *  counters, combat rings, targeting and abilities are inherited unchanged
     *  (composition over duplication — PRD #621). The parent supplies the fully
     *  wired `BoardBattlefieldCard` (visual state + click + abilities). */
    renderMember: (card: CardInstance) => React.ReactNode;
};

/** One permanent stack on the spatial battlefield (PRD #621). Dispatches on size
 *  to the right size-driven presentation — all sharing ONE fixed footprint slot:
 *
 *  - **1 member** → the lone card, no fan/badge.
 *  - **2–8 members** → a horizontal {@link BattlefieldStackFan} (issue #623),
 *    each member individually clickable with per-member hover-lift.
 *  - **>8 members** → a tight diagonal {@link BattlefieldStackDepthPile}
 *    (issue #624) at ~one-card footprint with the `×N` badge, expanding to the
 *    full fan in a high-z overlay on hover.
 *
 *  **Fixed footprint — hard rule (PRD #621).** Every presentation occupies the
 *  same one-card layout box the spatial layout reserves; fans, depth-piles,
 *  hover-lifts and hover-expansions all float in absolute overlays and NEVER
 *  change the layout box or push neighbouring permanents. */
export default function BattlefieldStack({
    members,
    renderMember,
}: BattlefieldStackProps) {
    const n = members.length;

    // A single member is just the card — no fan, no badge.
    if (n <= 1) {
        return (
            <div className="relative w-full h-full">
                {renderMember(members[0])}
            </div>
        );
    }

    // Large stacks (>8) collapse to a depth-pile that expands on hover (#624);
    // 2–8 stacks render directly as the fan (#623, untouched).
    if (isDepthPile(n)) {
        return (
            <BattlefieldStackDepthPile
                members={members}
                renderMember={renderMember}
            />
        );
    }

    return (
        <BattlefieldStackFan members={members} renderMember={renderMember} />
    );
}
