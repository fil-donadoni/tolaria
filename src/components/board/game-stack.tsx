import { useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { StackItem } from "~/types/game";
import {
    getAbilityOracleText,
    getTriggeredAbilityOracleText,
    matchesSpellTypeFilter,
    matchesSpellSingleTargetingController,
    matchesSpellWouldDestroyLand,
    wantsSpellTarget,
} from "~/lib/card-utils";
import { useGameContext } from "~/hooks/useGameContext";
import { useArrowHighlight } from "~/hooks/arrowHighlightContext";
import { useDraggable } from "~/hooks/useDraggable";
import { repositionLeaderLines } from "~/hooks/use-leader-lines";
import DragHandle from "./drag-handle";
import StackAbilityTile from "./stack-ability-tile";
import ColorOverlayCardImage from "../cards/color-overlay-card-image";

type GameStackProps = {
    stack: StackItem[];
};

export default function GameStack({ stack }: GameStackProps) {
    const { gameId, playerId, pendingTarget, allPlayers } = useGameContext();
    const selectTarget = useMutation(api.game.selectTarget);
    const { offset, dragHandlers } = useDraggable();
    // Arrow hover-highlight (combat-read): a stack item dims when a relationship
    // is hovered and it is not part of it, lights when it is, and seeds the
    // channel with its own id on hover so the arrow layer resolves the
    // relationship. No-op on the classic board (no provider).
    const highlight = useArrowHighlight();
    const setSeed = highlight?.setSeed;

    // The panel moves via CSS transform, which fires no resize/scroll event,
    // so target arrows would keep stale endpoints. Re-anchor them on every
    // offset change — this runs each pointermove during a drag.
    useEffect(() => {
        repositionLeaderLines();
    }, [offset.x, offset.y]);

    const canTargetSpell =
        !!pendingTarget &&
        pendingTarget.playerId === playerId &&
        wantsSpellTarget(pendingTarget.targetType);

    // Display in LIFO order: last cast on top (leftmost)
    const reversed = [...stack].reverse();

    return (
        <div
            // Play-area layout rule: anchor the stack to the right edge of the
            // play area (just LEFT of the reserved right strip), not the
            // viewport. `--right-piles-w` resolves in-tree under
            // `data-board-root`; portrait ⇒ 0px ⇒ flush to the viewport edge
            // (and the portrait chip path renders the stack differently anyway).
            className="absolute top-1/2 z-100"
            style={{
                right: "var(--right-piles-w)",
                transform: `translate(${offset.x}px, calc(-50% + ${offset.y}px))`,
            }}
        >
            <div className="relative bg-surface border border-border-subtle rounded-sm shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden">
                <div className="absolute top-1.5 left-1.5 w-3 h-3 border-t border-l border-border-accent/40 pointer-events-none z-10" />
                <div className="absolute top-1.5 right-1.5 w-3 h-3 border-t border-r border-border-accent/40 pointer-events-none z-10" />
                <div className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b border-l border-border-accent/40 pointer-events-none z-10" />
                <div className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b border-r border-border-accent/40 pointer-events-none z-10" />
                <DragHandle label="Stack" handlers={dragHandlers} />
                <div className="flex items-start p-3">
                    {reversed.map((item, i) => {
                        const abilityKind: "activated" | "triggered" | null =
                            item.abilityId
                                ? "activated"
                                : item.triggeredAbilityId
                                  ? "triggered"
                                  : null;
                        const abilityText =
                            abilityKind === "activated"
                                ? getAbilityOracleText(
                                      item.card.id,
                                      item.abilityId!
                                  )
                                : abilityKind === "triggered"
                                  ? getTriggeredAbilityOracleText(
                                        item.card.id,
                                        item.triggeredAbilityId!,
                                        item.grantedTriggeredAbilities
                                    )
                                  : null;
                        const isTargetable =
                            canTargetSpell &&
                            matchesSpellTypeFilter(
                                item,
                                pendingTarget?.spellTypeFilter
                            ) &&
                            matchesSpellSingleTargetingController(
                                item,
                                pendingTarget?.spellSingleTargetingController,
                                playerId
                            ) &&
                            matchesSpellWouldDestroyLand(
                                item,
                                pendingTarget?.spellWouldDestroyLandYouControl,
                                allPlayers,
                                playerId
                            );

                        const litState = highlight?.nodes
                            ? highlight.nodes.has(item.id)
                                ? "lit"
                                : "unlit"
                            : null;

                        return (
                            <button
                                key={item.id}
                                type="button"
                                data-arrow-anchor-stack={item.id}
                                disabled={!isTargetable}
                                onPointerEnter={
                                    setSeed
                                        ? () => setSeed({ nodeId: item.id })
                                        : undefined
                                }
                                onPointerLeave={
                                    setSeed ? () => setSeed(null) : undefined
                                }
                                onClick={() => {
                                    if (!isTargetable) return;
                                    selectTarget({
                                        gameId,
                                        playerId,
                                        targetType: "spell",
                                        targetId: item.id,
                                    });
                                }}
                                className={`w-32 shrink-0 flex flex-col items-center bg-transparent border-0 p-0 transition-opacity duration-150 ${
                                    isTargetable
                                        ? "cursor-pointer ring-2 ring-amber-400 rounded hover:ring-amber-300"
                                        : "cursor-default"
                                }`}
                                style={{
                                    marginLeft: i > 0 ? "-4rem" : undefined,
                                    // Lit items ride above the rest of the
                                    // (overlapping) stack while highlighted, so
                                    // the relationship reads on top.
                                    zIndex:
                                        litState === "lit"
                                            ? reversed.length + 100 - i
                                            : reversed.length - i,
                                    opacity: litState === "unlit" ? 0.3 : 1,
                                }}
                            >
                                {abilityKind && abilityText ? (
                                    <StackAbilityTile
                                        cardId={item.card.id}
                                        abilityText={abilityText}
                                        kind={abilityKind}
                                    />
                                ) : (
                                    <ColorOverlayCardImage card={item} />
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
