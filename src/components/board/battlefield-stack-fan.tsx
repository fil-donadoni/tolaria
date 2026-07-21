import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { CardInstance } from "~/types/game";
import { stackFanOffset, STACK_COUNT_BADGE_MIN } from "~/lib/board-layout";
import { SLOT_SPRING } from "~/lib/board-motion";

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
    /** Carry per-member shared-layout identity (`layoutId = card.id`) so a
     *  tap/untap flies a permanent between the untapped/tapped piles (QA).
     *  The depth-pile's hover-expanded overlay passes false: it is a transient
     *  browse state mounted ALONGSIDE the collapsed pile (which already owns
     *  the ids) — duplicate layoutIds would corrupt the FLIP. */
    memberLayoutIds?: boolean;
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
 *  is a transform + z bump on an INNER div (so it never fights the FLIP
 *  transform the shared-layout identity writes on the outer motion.div).
 *  Neither ever changes the layout box or pushes neighbours — the prototype's
 *  reflow-on-hover is the explicit anti-pattern.
 *
 *  Used directly for stacks of 2–8 members, and as the **overlay-expanded** form
 *  of a depth-pile (>8) on hover ({@link BattlefieldStackDepthPile}). */
export default function BattlefieldStackFan({
    members,
    renderMember,
    showBadge = true,
    memberLayoutIds = true,
}: BattlefieldStackFanProps) {
    const [lifted, setLifted] = useState<string | null>(null);
    const reduceMotion = useReducedMotion();
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
                    <motion.div
                        key={card.id}
                        data-stack-member={card.id}
                        data-flight-id={memberLayoutIds ? card.id : undefined}
                        // Shared-layout identity per member: a tap/untap moves
                        // the card between the untapped/tapped piles and the
                        // FLIP flies it there (QA); within the fan, position
                        // changes tween too.
                        layout={memberLayoutIds}
                        layoutId={memberLayoutIds ? card.id : undefined}
                        transition={
                            reduceMotion ? { duration: 0 } : SLOT_SPRING.motion
                        }
                        // Each member floats over the fixed slot box in an
                        // absolute overlay (left offset only) — the parent slot
                        // keeps its one-card footprint and never reflows.
                        className="absolute top-0 w-full h-full"
                        style={{
                            left: `${i * offset}px`,
                            // Resting z follows fan order (later members paint on
                            // top); a hovered member jumps above everything so it
                            // is fully readable/clickable.
                            zIndex: isLifted ? 100 : 10 + i,
                        }}
                    >
                        {/* Lift lives on an INNER div — framer's FLIP owns the
                            outer transform during flights. */}
                        <div
                            className="w-full h-full transition-transform duration-150"
                            style={{
                                transform: isLifted
                                    ? "translateY(-16px)"
                                    : undefined,
                            }}
                            onPointerEnter={() => setLifted(card.id)}
                            onPointerLeave={() =>
                                setLifted((cur) =>
                                    cur === card.id ? null : cur
                                )
                            }
                        >
                            {renderMember(card)}
                        </div>
                    </motion.div>
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
