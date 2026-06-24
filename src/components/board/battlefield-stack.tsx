import { useState } from "react";
import type { CardInstance } from "~/types/game";
import { stackFanOffset } from "~/lib/board-layout";

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

/** One permanent stack rendered as a horizontal **fan** (PRD #621, issue #623).
 *
 *  Members 2–8 overlap by a fixed reveal offset clamped to a max fan width
 *  ({@link stackFanOffset}); each member composes the existing
 *  {@link BoardBattlefieldCard} so every per-card behaviour (tap rotation, P/T,
 *  counters, combat rings, targeting, abilities) is inherited verbatim and stays
 *  individually clickable.
 *
 *  **Fixed footprint — hard rule.** The stack's layout box is exactly one card
 *  (the slot the spatial layout reserves); the fan and any hover-lift float in an
 *  absolute, high-z overlay ABOVE neighbours and NEVER change the layout box or
 *  push neighbouring permanents. Hovering a member raises its z-index and pops it
 *  up (~16px) so the exact instance is readable/clickable even when members
 *  heavily overlap — the prototype's reflow-on-hover is the explicit anti-pattern
 *  this avoids.
 *
 *  A `×N` count badge sits top-right on every stack with ≥2 members. Members are
 *  pre-ordered untapped-then-tapped by `groupBattlefield`. */
export default function BattlefieldStack({
    members,
    renderMember,
}: BattlefieldStackProps) {
    const [lifted, setLifted] = useState<string | null>(null);
    const n = members.length;
    const offset = stackFanOffset(n);

    // A single member is just the card — no fan, no badge.
    if (n <= 1) {
        return (
            <div className="relative w-full h-full">
                {renderMember(members[0])}
            </div>
        );
    }

    return (
        <div
            className="relative w-full h-full"
            data-permanent-stack
            data-stack-size={n}
        >
            {members.map((card, i) => {
                const isLifted = lifted === card.id;
                return (
                    <div
                        key={card.id}
                        data-stack-member={card.id}
                        // Each member floats over the fixed slot box in an
                        // absolute overlay (left offset only) — the parent slot
                        // keeps its one-card footprint and never reflows. Lift is
                        // a transform + z bump, both purely visual.
                        className="absolute top-0 w-full h-full transition-transform duration-150"
                        style={{
                            left: `${i * offset}px`,
                            // Resting z follows fan order (later members paint on
                            // top); a hovered member jumps above everything so it
                            // is fully readable/clickable.
                            zIndex: isLifted ? 100 : 10 + i,
                            transform: isLifted
                                ? "translateY(-16px)"
                                : undefined,
                        }}
                        onPointerEnter={() => setLifted(card.id)}
                        onPointerLeave={() =>
                            setLifted((cur) => (cur === card.id ? null : cur))
                        }
                    >
                        {renderMember(card)}
                    </div>
                );
            })}
            {/* ×N count badge — top-right, pinned to the lead member's box so it
                never shifts with the fan. */}
            <div
                data-stack-count
                className="absolute -top-1.5 -right-1.5 z-[110] pointer-events-none rounded-full bg-black/85 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white ring-1 ring-white/30 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
            >
                ×{n}
            </div>
        </div>
    );
}
