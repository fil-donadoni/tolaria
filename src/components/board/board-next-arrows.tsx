import { useEffect, useMemo, useRef } from "react";
import type { StackItem } from "~/types/game";
import {
    buildCombatArrows,
    buildTargetArrows,
    emptyAnchorMap,
    resolveArrowHighlight,
    type TargetArrow,
} from "~/lib/target-arrow-geometry";
import { useArrowAnchors } from "~/hooks/arrowAnchorContext";
import { useArrowHighlight } from "~/hooks/arrowHighlightContext";
import { useDomAnchorPublisher } from "~/hooks/useDomAnchorPublisher";
import type { Combat } from "~/types/game";

type BoardNextArrowsProps = {
    stack: StackItem[];
    /** Current combat — drives blocker → attacker arrows. Omitted when not in
     *  combat (or in tests that exercise only target arrows). */
    combat?: Combat;
};

/** Gold accent tokens (ADR 0007). The arrow is a metallic gold filament: a soft
 *  gold aura, a gradient core, and a bright hairline highlight on top — no dark
 *  channel, no heavy glow. */
const ACCENT = "var(--color-accent)";
const STRONG = "var(--color-accent-strong)";

/** Opacity of arrows / nodes outside the hovered relationship. */
const DIM = 0.14;

/**
 * SVG arrow layer for the spatial board (PRD #249, slices #257 / combat-read).
 * Draws two unified-style families of metallic-gold arrows:
 *
 * - **target** — each stack item → the permanents / players / stack items it
 *   targets (US#14);
 * - **combat** — each blocker → the attacker it blocks (US#17), drawn while
 *   blocks are declared.
 *
 * Endpoints come from the {@link useArrowAnchors} registry (shared layout
 * placements for permanents, DOM rects for the discrete stack / player /
 * graveyard panels), so arrows stay glued to continuously-animating cards.
 *
 * Hover disambiguates crossing arrows: only the arrows are hoverable (a wide
 * invisible hit-stroke per path; the rest of every card stays clickable).
 * Hovering an arrow lights the WHOLE relationship at once — arrows AND the
 * cards / nameplates at their endpoints (published via
 * {@link useArrowHighlight} so the cards illuminate too) — and dims everything
 * else. Relationship = **direct 1-hop** for target arrows, the whole
 * **transitive cluster** for combat (banding-aware): in a 1-attacker /
 * 2-blocker knot, hovering either arrow lights both arrows and all three cards.
 */
export default function BoardNextArrows({
    stack,
    combat,
}: BoardNextArrowsProps) {
    const svgRef = useRef<SVGSVGElement>(null);
    const registry = useArrowAnchors();
    const channel = useArrowHighlight();

    // Re-measure DOM anchors when the stack identity set changes (items added /
    // resolved) so newly-mounted stack/player/graveyard anchors are picked up.
    const stackKey = useMemo(() => stack.map((s) => s.id).join(","), [stack]);
    useDomAnchorPublisher(svgRef, ["stack", "player", "graveyard"], stackKey);

    const anchors = registry?.anchors ?? emptyAnchorMap();
    const arrows = useMemo<TargetArrow[]>(
        () => [
            ...buildTargetArrows(stack, anchors),
            ...buildCombatArrows(combat, anchors),
        ],
        [stack, combat, anchors]
    );

    // The hover seed (an arrow `key` or a card `nodeId`) is shared via the
    // channel so battlefield cards can light their own cluster too; resolve it
    // here, where the arrow set + geometry live.
    const seed = channel?.seed ?? null;
    const highlight = useMemo(
        () => resolveArrowHighlight(arrows, seed),
        [arrows, seed]
    );

    // Publish the resolved node set so battlefield cards illuminate (or dim) in
    // lockstep with the hovered relationship.
    const publishNodes = channel?.setNodes;
    useEffect(() => {
        publishNodes?.(highlight ? highlight.nodes : null);
    }, [publishNodes, highlight]);

    const setSeed = channel?.setSeed;

    return (
        <svg
            ref={svgRef}
            className="pointer-events-none absolute inset-0 z-[60] h-full w-full overflow-visible"
            aria-hidden
            data-testid="board-next-arrows"
        >
            <defs>
                <linearGradient
                    id="board-next-arrow-grad"
                    x1="0"
                    y1="0"
                    x2="1"
                    y2="1"
                >
                    <stop offset="0%" stopColor={ACCENT} />
                    <stop offset="100%" stopColor={STRONG} />
                </linearGradient>
                {/* Crisp ornamental arrowhead, bright filament colour. */}
                <marker
                    id="board-next-arrowhead"
                    markerWidth="9"
                    markerHeight="9"
                    refX="6"
                    refY="4"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                >
                    <path d="M0,0.5 L8.5,4 L0,7.5 Q3,4 0,0.5 Z" fill={STRONG} />
                </marker>
                <filter
                    id="board-next-arrow-shadow"
                    x="-20%"
                    y="-20%"
                    width="140%"
                    height="140%"
                >
                    <feDropShadow
                        dx="0"
                        dy="1"
                        stdDeviation="1.6"
                        floodColor="#000"
                        floodOpacity="0.4"
                    />
                </filter>
            </defs>
            {arrows.map((arrow) => {
                const active = highlight ? highlight.keys.has(arrow.key) : true;
                // When a relationship is hovered, EVERY arrow in it is
                // emphasized together (not just the one under the cursor), so a
                // combat cluster lights up as a single unit.
                const emphasized = active && highlight !== null;
                return (
                    <g
                        key={arrow.key}
                        opacity={active ? 1 : DIM}
                        style={{ transition: "opacity 140ms ease" }}
                        filter="url(#board-next-arrow-shadow)"
                    >
                        {/* Wide invisible hit-stroke: only the line grabs hover;
                            the rest of every card underneath stays clickable. */}
                        <path
                            d={arrow.path}
                            fill="none"
                            stroke="transparent"
                            strokeWidth={18}
                            className="pointer-events-auto cursor-pointer"
                            onPointerEnter={() => setSeed?.({ key: arrow.key })}
                            onPointerLeave={() => setSeed?.(null)}
                        />
                        {/* Soft gold aura (no dark channel, no heavy glow). */}
                        <path
                            d={arrow.path}
                            fill="none"
                            stroke={ACCENT}
                            strokeWidth={emphasized ? 9 : 6}
                            strokeLinecap="round"
                            opacity={emphasized ? 0.32 : 0.18}
                        />
                        {/* Gradient core + arrowhead — the body of the wire. */}
                        <path
                            data-arrow-key={arrow.key}
                            data-arrow-kind={arrow.kind}
                            d={arrow.path}
                            fill="none"
                            stroke="url(#board-next-arrow-grad)"
                            strokeWidth={emphasized ? 3.4 : 2.4}
                            strokeLinecap="round"
                            markerEnd="url(#board-next-arrowhead)"
                        />
                        {/* Bright hairline highlight along the top — gives the
                            filament its metallic catch-light. */}
                        <path
                            d={arrow.path}
                            fill="none"
                            stroke={STRONG}
                            strokeWidth={emphasized ? 1.1 : 0.8}
                            strokeLinecap="round"
                            opacity={0.9}
                        />
                    </g>
                );
            })}
        </svg>
    );
}
