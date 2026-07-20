import { useState } from "react";
import type { CardInstance } from "~/types/game";
import { stackFanOffset, STACK_COUNT_BADGE_MIN } from "~/lib/board-layout";

type BattlefieldStackFanProps = {
    /** Ordered stack members (untapped first, then tapped — already sorted by
     *  `groupBattlefield`). */
    members: CardInstance[];
    /** Renders ONE member as the existing battlefield card so every per-card
     *  behaviour (tap rotation, P/T, counters, combat rings, targeting,
     *  abilities) is inherited verbatim. */
    renderMember: (card: CardInstance) => React.ReactNode;
    /** Show the `×N` count badge (top-right). The depth-pile overlay suppresses
     *  it because the collapsed pile already carries its own badge. */
    showBadge?: boolean;
};

/** The horizontal **fan** body of a permanent stack (PRD #621, issue #623).
 *
 *  Members overlap by a fixed reveal offset clamped to a max fan width
 *  ({@link stackFanOffset}); each member composes the caller-supplied
 *  `renderMember` (the wired {@link BoardBattlefieldCard}) so it stays
 *  individually clickable. Hovering a member raises its z-index and pops it up
 *  (~16px) so the exact instance is readable even when members heavily overlap.
 *
 *  **Fixed footprint — hard rule (PRD #621).** Members float in an absolute
 *  overlay (`left` offset only) over the parent's one-card slot box; hover-lift
 *  is a transform + z bump. Neither ever changes the layout box or pushes
 *  neighbours — the prototype's reflow-on-hover is the explicit anti-pattern.
 *
 *  Used directly for stacks of 2–8 members, and as the **overlay-expanded** form
 *  of a depth-pile (>8) on hover ({@link BattlefieldStackDepthPile}). */
export default function BattlefieldStackFan({
    members,
    renderMember,
    showBadge = true,
}: BattlefieldStackFanProps) {
    const [lifted, setLifted] = useState<string | null>(null);
    const n = members.length;
    const offset = stackFanOffset(n);

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
            {/* ×N count badge — only from STACK_COUNT_BADGE_MIN up (small fans
                show every member anyway), pinned INSIDE the lead member's
                top-right corner so it never overlaps the row above (QA). */}
            {showBadge && n >= STACK_COUNT_BADGE_MIN && (
                <div
                    data-stack-count
                    className="absolute top-1.5 -right-1.5 z-modal-top pointer-events-none rounded-full bg-black/85 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white ring-1 ring-white/30 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
                >
                    ×{n}
                </div>
            )}
        </div>
    );
}
