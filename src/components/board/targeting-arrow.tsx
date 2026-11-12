import { useRef } from "react";
import { useArrowAnchors } from "~/hooks/arrowAnchorContext";
import { useTargetingCancelGestures } from "~/hooks/useTargetingCancelGestures";
import { useTargetingPointer } from "~/hooks/useTargetingPointer";
import type { ActiveTargeting } from "~/hooks/useTargetingSession";
import { arrowPath, emptyAnchorMap } from "~/lib/target-arrow-geometry";
import {
    targetingNodeKey,
    targetingNodePoint,
    type TargetingNode,
} from "~/lib/targeting-session";

/** Same gold filament tokens as `BoardArrows` (ADR 0007) — the targeting
 *  arrow reads as the arrow the choice will become. */
const ACCENT = "var(--color-accent)";
const STRONG = "var(--color-accent-strong)";
const NOOP = () => {};

const NO_SESSION_NODES: TargetingNode[] = [];

/**
 * Arena-parity targeting arrow (issue #9163): while the viewer chooses a
 * target — an attacker's attack target (CR 508.1b) or a spell / ability
 * target (CR 601.2c, `pendingTarget`) — a thin arrow leaves the source and
 * rides the cursor, snapping onto a legal target on hover. The source is
 * ringed, each legal target carries a pulsing pip, and `BoardArrows` dims the
 * rest of the board (it lights the session's nodes). Escape / right-click
 * cancels.
 *
 * Touch: a finger has no hover, so no arrow is drawn — the source ring and
 * target pips still mark the choice.
 *
 * `pointer-events: none`: every click still reaches the real card, nameplate,
 * stack row or graveyard pile and goes through its own handler.
 */
export default function TargetingArrow({
    session,
}: {
    session: ActiveTargeting | null;
}) {
    const svgRef = useRef<SVGSVGElement>(null);
    const registry = useArrowAnchors();
    const anchors = registry?.anchors ?? emptyAnchorMap();
    const sources = session?.sources ?? NO_SESSION_NODES;
    const cardSourceIds = sources
        .filter((n) => n.kind === "card")
        .map((n) => n.id);
    const { point, overKey, cardPoints } = useTargetingPointer(
        svgRef,
        !!session,
        cardSourceIds
    );
    useTargetingCancelGestures(!!session, session?.cancel ?? NOOP);

    if (!session) return null;

    const targetKeys = session.targets.map(targetingNodeKey);
    const locked = overKey !== null && targetKeys.includes(overKey);
    const lockedNode = locked
        ? session.targets[targetKeys.indexOf(overKey)]
        : undefined;
    const tip =
        (lockedNode && targetingNodePoint(lockedNode, anchors, cardPoints)) ??
        point;

    return (
        <svg
            ref={svgRef}
            className="pointer-events-none absolute inset-0 z-arrows h-full w-full overflow-visible"
            aria-hidden
            data-testid="targeting-arrow"
            data-targeting-mode={session.mode}
            data-targeting-sources={sources.map(targetingNodeKey).join(" ")}
            data-targeting-targets={targetKeys.join(" ")}
        >
            <defs>
                <marker
                    id="targeting-arrowhead"
                    markerWidth="9"
                    markerHeight="9"
                    refX="6"
                    refY="4"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                >
                    <path d="M0,0.5 L8.5,4 L0,7.5 Q3,4 0,0.5 Z" fill={STRONG} />
                </marker>
            </defs>
            {session.targets.map((node, i) => {
                const p = targetingNodePoint(node, anchors, cardPoints);
                if (!p) return null;
                const isLocked = targetKeys[i] === overKey;
                return (
                    <circle
                        key={targetKeys[i]}
                        data-targeting-pip={targetKeys[i]}
                        cx={p.x}
                        cy={p.y}
                        r={isLocked ? 9 : 6}
                        fill="none"
                        stroke={STRONG}
                        strokeWidth={isLocked ? 2.4 : 1.6}
                        className={
                            isLocked ? undefined : "motion-safe:animate-pulse"
                        }
                    />
                );
            })}
            {sources.map((node) => {
                const from = targetingNodePoint(node, anchors, cardPoints);
                if (!from) return null;
                const key = targetingNodeKey(node);
                return (
                    <g key={key} data-targeting-source={key}>
                        <circle
                            cx={from.x}
                            cy={from.y}
                            r={10}
                            fill="none"
                            stroke={ACCENT}
                            strokeWidth={2}
                        />
                        {tip && (
                            <path
                                data-targeting-path
                                data-locked={locked ? "true" : "false"}
                                d={arrowPath(from, tip)}
                                fill="none"
                                stroke={STRONG}
                                strokeWidth={locked ? 3 : 2}
                                strokeLinecap="round"
                                markerEnd="url(#targeting-arrowhead)"
                            />
                        )}
                    </g>
                );
            })}
        </svg>
    );
}
