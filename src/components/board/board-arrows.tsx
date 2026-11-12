import { useEffect, useMemo, useRef, useState } from "react";
import type { StackItem } from "~/types/game";
import { useAttackSequence } from "~/hooks/useAttackSequence";
import {
    buildCombatArrows,
    buildManualArrows,
    buildTargetArrows,
    emptyAnchorMap,
    hitTestArrows,
    resolveArrowHighlight,
    type AnchorPoint,
    type ManualArrowPair,
    type TargetArrow,
} from "~/lib/target-arrow-geometry";
import { useArrowAnchors } from "~/hooks/arrowAnchorContext";
import {
    useArrowHighlight,
    type ArrowHoverSeed,
} from "~/hooks/arrowHighlightContext";
import { useDomAnchorPublisher } from "~/hooks/useDomAnchorPublisher";
import type { Combat } from "~/types/game";
import type { ArrowStrength } from "~/lib/board-arrow-style";
import ArrowDefs from "./board-arrow-defs";
import BoardArrowPath from "./board-arrow-path";
import ArrowFocusLayer from "./arrow-focus-layer";

type BoardArrowsProps = {
    stack: StackItem[];
    /** Current combat — drives blocker → attacker and attacker → attack-target
     *  arrows. Omitted when not in combat (or in tests that exercise only
     *  target arrows). */
    combat?: Combat;
    /** The player being attacked this combat — the nameplate anchor attack
     *  arrows point at when no planeswalker target is chosen (CR 508.1a). */
    defenderId?: string | null;
    /** Bump when the seat→player-id assignment changes (solo viewer swap):
     *  the DOM publisher only re-measures on resize/scroll/stack-change, so
     *  without this the player anchors stay swapped after a swap and every
     *  player-pointing arrow (incl. attack arrows) lands on the wrong
     *  nameplate. */
    anchorRevision?: string;
    /** Generic arrow input alongside stack targets / combat (issue #2171):
     *  Manual Mode has no `StackItem`/`Combat` at all (ADR 0080), so its
     *  player-declared arrows come in as raw permanent → permanent pairs
     *  rather than a synthesized fake stack item — this is the arrow layer's
     *  ONE non-GRE-shaped input, resolved through the same anchor registry as
     *  every other arrow. */
    extraArrows?: ManualArrowPair[];
    /** While the viewer chooses a target (issue #9163): the source + legal
     *  target node ids. Overrides hover — they stay lit, every other card,
     *  stack row and arrow dims, so the choice reads at a glance. */
    targetingNodeIds?: ReadonlySet<string> | null;
};

/** Opacity of arrows / nodes outside the hovered relationship. */
const DIM = 0.14;

const BOARD_DEF_IDS = {
    grad: "board-arrow-grad",
    head: "board-arrowhead",
    shadow: "board-arrow-shadow",
};

/** A stack target arrow (issue #9326) — drawn quiet at rest. Combat and
 *  Manual Mode arrows carry no stack item and keep today's filament. */
function restStrength(arrow: TargetArrow): ArrowStrength {
    return arrow.stackItemId ? "quiet" : "normal";
}

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
 * Hover disambiguates crossing arrows. The whole layer is `pointer-events:
 * none` — an arrow is never a click target, so a left/right click or drag on a
 * card it crosses reaches the card (issue #5853). Arrow hover is a passive
 * proximity hit-test ({@link hitTestArrows}) run by a `pointermove` listener on
 * the board root; within reach of an arrow it wins over the card-hover seed.
 * Hovering an arrow lights the WHOLE relationship at once — arrows AND the
 * cards / nameplates at their endpoints (published via
 * {@link useArrowHighlight} so the cards illuminate too) — and dims everything
 * else. Relationship = **direct 1-hop** for target arrows, the whole
 * **transitive cluster** for combat (banding-aware): in a 1-attacker /
 * 2-blocker knot, hovering either arrow lights both arrows and all three cards.
 */
export default function BoardArrows({
    stack,
    combat,
    defenderId,
    anchorRevision,
    extraArrows,
    targetingNodeIds,
}: BoardArrowsProps) {
    const svgRef = useRef<SVGSVGElement>(null);
    const registry = useArrowAnchors();
    const channel = useArrowHighlight();

    // Re-measure DOM anchors when the stack identity set changes (items added /
    // resolved) so newly-mounted stack/player/graveyard anchors are picked up.
    const stackKey = useMemo(() => stack.map((s) => s.id).join(","), [stack]);
    useDomAnchorPublisher(
        svgRef,
        ["stack", "player", "graveyard", "stackTarget"],
        `${stackKey}|${anchorRevision ?? ""}`,
        // The portrait bottom bar mounts as a sibling of the board root
        // (`board.tsx`), outside where this scan would otherwise look — the
        // viewer's inline zone-chip graveyard anchor lives there (#1815
        // review fixup round 2). See `useDomAnchorPublisher`'s doc comment.
        "[data-controller-bottom-bar]"
    );

    const { undecidedAttackerIds } = useAttackSequence();
    const anchors = registry?.anchors ?? emptyAnchorMap();
    const arrows = useMemo<TargetArrow[]>(
        () => [
            ...buildTargetArrows(stack, anchors),
            ...buildCombatArrows(
                combat,
                anchors,
                defenderId,
                undecidedAttackerIds
            ),
            ...buildManualArrows(extraArrows ?? [], anchors),
        ],
        [stack, combat, anchors, defenderId, extraArrows, undecidedAttackerIds]
    );

    // Passive arrow hover (issue #5853): the board root's pointer position is
    // hit-tested against the arrow curves. The last pointer point is kept in a
    // ref (not state) so moving the mouse re-renders only when the hovered
    // arrow changes; the arrow set changing under a still pointer re-tests it,
    // so a resolved stack item / ended combat never leaves a stuck seed.
    const [hoveredKey, setHoveredKey] = useState<string | null>(null);
    const pointerRef = useRef<AnchorPoint | null>(null);
    const arrowsRef = useRef(arrows);
    useEffect(() => {
        arrowsRef.current = arrows;
        const p = pointerRef.current;
        setHoveredKey(p ? hitTestArrows(arrows, p) : null);
    }, [arrows]);
    useEffect(() => {
        const root = svgRef.current?.parentElement;
        if (!root) return;
        const onMove = (e: PointerEvent) => {
            // Touch has no hover and no leave on lift: a drag would light an
            // arrow and leave it lit.
            if (e.pointerType === "touch") return;
            const rect = svgRef.current?.getBoundingClientRect();
            if (!rect) return;
            const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            pointerRef.current = p;
            setHoveredKey(hitTestArrows(arrowsRef.current, p));
        };
        const onLeave = () => {
            pointerRef.current = null;
            setHoveredKey(null);
        };
        root.addEventListener("pointermove", onMove);
        root.addEventListener("pointerleave", onLeave);
        return () => {
            root.removeEventListener("pointermove", onMove);
            root.removeEventListener("pointerleave", onLeave);
        };
    }, []);

    // The hover seed: a hovered arrow wins; otherwise the channel's seed (a
    // card `nodeId`, shared so battlefield cards can light their own cluster
    // too). Resolved here, where the arrow set + geometry live.
    const channelSeed = channel?.seed ?? null;
    const seed = useMemo<ArrowHoverSeed>(
        () => (hoveredKey ? { key: hoveredKey } : channelSeed),
        [hoveredKey, channelSeed]
    );
    const highlight = useMemo(
        () =>
            targetingNodeIds
                ? { keys: new Set<string>(), nodes: targetingNodeIds }
                : resolveArrowHighlight(arrows, seed),
        [arrows, seed, targetingNodeIds]
    );

    // Publish the resolved node set so battlefield cards illuminate (or dim) in
    // lockstep with the hovered relationship.
    const publishNodes = channel?.setNodes;
    useEffect(() => {
        publishNodes?.(highlight ? highlight.nodes : null);
    }, [publishNodes, highlight]);

    // A targeting relationship in focus (issue #9326) veils the board; its
    // lit arrows are drawn above the veil by the focus layer, so this layer
    // skips them (a blurred copy under the veil would halo the sharp one).
    const targetFocus = highlight?.focus === "target" ? highlight : null;
    const focusArrows = useMemo(
        () =>
            targetFocus
                ? arrows.filter((a) => targetFocus.keys.has(a.key))
                : [],
        [arrows, targetFocus]
    );

    return (
        <svg
            ref={svgRef}
            className="pointer-events-none absolute inset-0 z-arrows h-full w-full overflow-visible"
            aria-hidden
            data-testid="board-arrows"
        >
            <ArrowDefs ids={BOARD_DEF_IDS} />
            {arrows.map((arrow) => {
                if (targetFocus?.keys.has(arrow.key)) return null;
                const active = highlight ? highlight.keys.has(arrow.key) : true;
                // When a relationship is hovered, EVERY arrow in it is
                // emphasized together (not just the one under the cursor), so a
                // combat cluster lights up as a single unit. Nothing hovered:
                // a stack target arrow rests quiet (issue #9326).
                const strength: ArrowStrength =
                    active && highlight !== null
                        ? "emphasized"
                        : restStrength(arrow);
                return (
                    <BoardArrowPath
                        key={arrow.key}
                        arrow={arrow}
                        strength={strength}
                        dimmed={!active}
                        dimOpacity={DIM}
                        ids={BOARD_DEF_IDS}
                    />
                );
            })}
            {targetFocus && (
                <ArrowFocusLayer
                    boardRef={svgRef}
                    nodes={targetFocus.nodes}
                    arrows={focusArrows}
                />
            )}
        </svg>
    );
}
