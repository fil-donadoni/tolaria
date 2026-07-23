import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { StackItem } from "~/types/game";
import {
    matchesSpellTypeFilter,
    matchesSpellExcludeTypeFilter,
    matchesSpellCreaturePtFilter,
    matchesSpellSingleTargetingController,
    matchesSpellController,
    matchesSpellWouldDestroyLand,
    matchesStackObjectFilter,
    wantsSpellTarget,
} from "~/lib/card-utils";
import { useGameContext } from "~/hooks/useGameContext";
import { useArrowHighlight } from "~/hooks/arrowHighlightContext";
import { useDraggable } from "~/hooks/useDraggable";
import { repositionAnchors } from "~/hooks/anchor-reposition";
import { Panel } from "~/components/ui/panel";
import DragHandle from "./drag-handle";
import StackRow from "./stack-row";

type GameStackProps = {
    stack: StackItem[];
};

/** How many top rows the collapsed list shows before the "N more" expander. */
const COLLAPSED_ROWS = 3;

/** The readable stack (phase 2, winner B — replaces the 50%-overlap cascade):
 *  a vertical list of card-forward rows — resolve order, controller, name +
 *  mana pips, chosen mode, FULL oracle text, and every target as a chip. The
 *  target ARROWS show by default for the top item and switch to any hovered
 *  row's relationship (the shared arrow-highlight channel dims the rest).
 *
 *  Kept from the old cascade: shared-layout flights (hand → stack →
 *  destination, layoutId per item), the draggable panel (re-anchoring arrows
 *  via the shared reposition event), spell-target clicks, arrival glow. */
export default function GameStack({ stack }: GameStackProps) {
    const {
        gameId,
        playerId,
        pendingTarget,
        allPlayers,
        activePlayerId,
        recentArrivals,
    } = useGameContext();
    const selectTarget = useMutation(api.game.selectTarget);
    const { offset, dragHandlers } = useDraggable();
    const highlight = useArrowHighlight();
    const setSeed = highlight?.setSeed;
    const [expanded, setExpanded] = useState(false);

    // Display in LIFO order: last cast on top (first row).
    const reversed = [...stack].reverse();

    // No default seed: EVERY stack item's target arrows are drawn at full
    // strength as soon as it hits the stack. Seeding the top item dimmed every
    // other relationship to 14% — with 2+ items on the stack the board read as
    // having no arrows at all. Hovering a row still isolates its relationship;
    // leaving clears back to "all lit".
    useEffect(() => {
        if (!setSeed) return;
        return () => setSeed(null);
    }, [setSeed]);

    // The panel moves via CSS transform, which fires no resize/scroll event,
    // so target arrows would keep stale endpoints. Re-anchor them on every
    // offset change — this runs each pointermove during a drag.
    useEffect(() => {
        repositionAnchors();
    }, [offset.x, offset.y]);

    const canTargetSpell =
        !!pendingTarget &&
        pendingTarget.playerId === playerId &&
        wantsSpellTarget(pendingTarget.targetType);

    const visible = expanded ? reversed : reversed.slice(0, COLLAPSED_ROWS);
    const hidden = reversed.length - visible.length;

    return (
        <div
            // Play-area layout rule: anchor the stack to the right edge of the
            // play area (just LEFT of the reserved right strip), not the
            // viewport. `--right-piles-w` resolves in-tree under
            // `data-board-root`; portrait ⇒ 0px ⇒ flush to the viewport edge
            // (and the portrait chip path renders the stack differently anyway).
            className="absolute top-1/2 z-modal"
            style={{
                right: "var(--right-piles-w)",
                transform: `translate(${offset.x}px, calc(-50% + ${offset.y}px))`,
            }}
        >
            {/* overflow-visible, NOT -hidden: a spell flying in from the hand
                mounts inside this panel, and clipping it to the panel box would
                hide the flight until it crosses the boundary. */}
            <div className="relative overflow-visible">
                <Panel
                    density="compact"
                    className="max-h-[80vh] w-96 max-w-[92vw] overflow-visible p-0"
                >
                    <DragHandle
                        label={`Stack (${stack.length})`}
                        handlers={dragHandlers}
                    />
                    <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-2">
                        {visible.map((item, i) => {
                            const isTargetable =
                                canTargetSpell &&
                                matchesSpellTypeFilter(
                                    item,
                                    pendingTarget?.spellTypeFilter
                                ) &&
                                matchesSpellExcludeTypeFilter(
                                    item,
                                    pendingTarget?.spellExcludeTypeFilter
                                ) &&
                                matchesSpellCreaturePtFilter(
                                    item,
                                    pendingTarget?.spellCreaturePtFilter
                                ) &&
                                matchesSpellSingleTargetingController(
                                    item,
                                    pendingTarget?.spellSingleTargetingController,
                                    playerId
                                ) &&
                                matchesSpellController(
                                    item,
                                    pendingTarget?.controller,
                                    playerId,
                                    activePlayerId
                                ) &&
                                matchesSpellWouldDestroyLand(
                                    item,
                                    pendingTarget?.spellWouldDestroyLandYouControl,
                                    allPlayers,
                                    playerId
                                ) &&
                                matchesStackObjectFilter(
                                    item,
                                    pendingTarget?.spellStackKind,
                                    pendingTarget?.stackSourceTypeFilter,
                                    pendingTarget?.spellTargetsInstanceIds
                                );

                            const dimmed =
                                highlight?.nodes != null &&
                                !highlight.nodes.has(item.id);

                            return (
                                <StackRow
                                    key={item.id}
                                    item={item}
                                    order={i + 1}
                                    isTop={i === 0}
                                    isTargetable={!!isTargetable}
                                    onSelect={() => {
                                        if (!isTargetable) return;
                                        selectTarget({
                                            gameId,
                                            playerId,
                                            targetType: "spell",
                                            targetId: item.id,
                                        });
                                    }}
                                    onHoverSeed={(seeding) => {
                                        if (!setSeed) return;
                                        setSeed(
                                            seeding ? { nodeId: item.id } : null
                                        );
                                    }}
                                    dimmed={dimmed}
                                    arrived={
                                        recentArrivals?.has(item.id) === true
                                    }
                                    allPlayers={allPlayers}
                                    viewerId={playerId}
                                />
                            );
                        })}
                        {hidden > 0 && (
                            <button
                                type="button"
                                className="rounded-sm border border-border-subtle px-2 py-1 text-center text-[10px] text-accent-strong hover:bg-accent-soft/20"
                                onClick={() => setExpanded(true)}
                                onMouseEnter={() => setExpanded(true)}
                            >
                                ▾ {hidden} more below
                            </button>
                        )}
                    </div>
                </Panel>
            </div>
        </div>
    );
}
