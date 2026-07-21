import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { CardInstance } from "~/types/game";
import { stackDepthOffset } from "~/lib/board-layout";
import { SLOT_SPRING } from "~/lib/board-motion";
import BattlefieldStackFan from "./battlefield-stack-fan";

type BattlefieldStackDepthPileProps = {
    /** Ordered stack members (untapped first, then tapped — already sorted by
     *  `groupBattlefield`). Always >8 for a real depth-pile. */
    members: CardInstance[];
    /** Renders ONE member as the existing battlefield card (the wired
     *  {@link BoardBattlefieldCard}) so every per-card behaviour is inherited. */
    renderMember: (card: CardInstance) => React.ReactNode;
};

/** A large permanent stack (>8) rendered as a tight diagonal **depth-pile**
 *  (PRD #621, issue #624).
 *
 *  Resting: members step down-and-right by a tiny offset ({@link
 *  stackDepthOffset}) so the whole pile reads as a small deck of cards within
 *  roughly **one card's footprint** — huge token/land counts no longer dominate
 *  the board. A `×N` badge reports the true member count.
 *
 *  On hover the pile **expands into the full fan** — rendered in an absolute,
 *  high-z **overlay** ({@link BattlefieldStackFan}) so every member becomes
 *  individually selectable, then the per-member hover-lift from #623 applies.
 *
 *  **Fixed footprint — hard rule (PRD #621).** Both the resting pile and the
 *  hover overlay are positioned absolutely over the parent's one-card slot box;
 *  the overlay floats ABOVE neighbours and NEVER changes the layout box or
 *  pushes/reflows neighbouring permanents. The collapsed pile keeps its
 *  one-card footprint whether or not it is hovered. */
export default function BattlefieldStackDepthPile({
    members,
    renderMember,
}: BattlefieldStackDepthPileProps) {
    const [expanded, setExpanded] = useState(false);
    const reduceMotion = useReducedMotion();
    const n = members.length;

    return (
        <div
            className="relative w-full h-full"
            data-permanent-stack
            data-stack-pile
            data-stack-size={n}
            onPointerEnter={() => setExpanded(true)}
            onPointerLeave={() => setExpanded(false)}
        >
            {/* Resting depth-pile: a tight diagonal of card faces at ~one-card
                footprint. Hidden (but kept mounted) while expanded so the slot
                box is stable. Pointer events live on the wrapper, so the whole
                pile is one hover target. */}
            <div
                data-stack-pile-collapsed
                className="relative w-full h-full"
                style={{ visibility: expanded ? "hidden" : "visible" }}
            >
                {members.map((card, i) => (
                    <motion.div
                        key={card.id}
                        data-stack-pile-member={card.id}
                        data-flight-id={card.id}
                        // Per-member shared-layout identity — the collapsed pile
                        // owns the ids (the hover-expanded fan passes
                        // memberLayoutIds={false} so they never duplicate).
                        layout
                        layoutId={card.id}
                        transition={
                            reduceMotion ? { duration: 0 } : SLOT_SPRING.motion
                        }
                        // Each face steps down-and-right by a tiny clamped offset;
                        // the spread is capped so the pile stays ~one card wide.
                        className="absolute top-0 left-0 w-full h-full"
                        style={{
                            transform: `translate(${stackDepthOffset(i)}px, ${stackDepthOffset(i)}px)`,
                            zIndex: 10 + i,
                            // Only the top face needs full detail / interactivity
                            // at rest; the deeper faces are decorative depth and
                            // must not steal clicks from the top member.
                            pointerEvents:
                                i === members.length - 1 ? "auto" : "none",
                        }}
                    >
                        {renderMember(card)}
                    </motion.div>
                ))}
                {/* ×N badge — INSIDE the pile's top-right corner (was -top-1.5,
                    which collided with the row above; QA). Depth piles are >8
                    by construction, always ≥ STACK_COUNT_BADGE_MIN. */}
                <div
                    data-stack-count
                    className="absolute top-1.5 -right-1.5 z-modal-top pointer-events-none rounded-full bg-black/85 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white ring-1 ring-white/30 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
                >
                    ×{n}
                </div>
            </div>

            {/* Hover-expanded full fan, floating in a high-z overlay over the
                fixed slot box (and above neighbours). Absolute → it never grows
                the layout box, so neighbouring permanents never reflow. */}
            {expanded && (
                <div
                    data-stack-pile-expanded
                    className="absolute top-0 left-0 z-modal-peak"
                    style={{ width: "100%", height: "100%" }}
                >
                    {/* No member layoutIds here — the collapsed pile owns them;
                        duplicating would corrupt the FLIP. */}
                    <BattlefieldStackFan
                        members={members}
                        renderMember={renderMember}
                        memberLayoutIds={false}
                    />
                </div>
            )}
        </div>
    );
}
