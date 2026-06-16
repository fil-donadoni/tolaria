import { useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { StackItem } from "~/types/game";
import {
    getAbilityOracleText,
    getTriggeredAbilityOracleText,
    matchesSpellTypeFilter,
    wantsSpellTarget,
} from "~/lib/card-utils";
import { useGameContext } from "~/hooks/useGameContext";
import { useDraggable } from "~/hooks/useDraggable";
import { repositionLeaderLines } from "~/hooks/use-leader-lines";
import DragHandle from "./drag-handle";
import StackAbilityTile from "./stack-ability-tile";
import ColorOverlayCardImage from "../cards/color-overlay-card-image";

type GameStackProps = {
    stack: StackItem[];
};

export default function GameStack({ stack }: GameStackProps) {
    const { gameId, playerId, pendingTarget } = useGameContext();
    const selectTarget = useMutation(api.game.selectTarget);
    const { offset, dragHandlers } = useDraggable();

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
            className="absolute top-1/2 right-4 z-50"
            style={{
                transform: `translate(${offset.x}px, calc(-50% + ${offset.y}px))`,
            }}
        >
            <div className="relative bg-[#0c0d12]/90 border border-zinc-800/80 backdrop-blur-md rounded-sm shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden">
                <div className="absolute top-1.5 left-1.5 w-3 h-3 border-t border-l border-zinc-500/40 pointer-events-none z-10" />
                <div className="absolute top-1.5 right-1.5 w-3 h-3 border-t border-r border-zinc-500/40 pointer-events-none z-10" />
                <div className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b border-l border-zinc-500/40 pointer-events-none z-10" />
                <div className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b border-r border-zinc-500/40 pointer-events-none z-10" />
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
                                        item.triggeredAbilityId!
                                    )
                                  : null;
                        const isTargetable =
                            canTargetSpell &&
                            matchesSpellTypeFilter(
                                item,
                                pendingTarget?.spellTypeFilter
                            );

                        return (
                            <button
                                key={item.id}
                                type="button"
                                data-arrow-anchor-stack={item.id}
                                disabled={!isTargetable}
                                onClick={() => {
                                    if (!isTargetable) return;
                                    selectTarget({
                                        gameId,
                                        playerId,
                                        targetType: "spell",
                                        targetId: item.id,
                                    });
                                }}
                                className={`w-32 shrink-0 flex flex-col items-center bg-transparent border-0 p-0 ${
                                    isTargetable
                                        ? "cursor-pointer ring-2 ring-amber-400 rounded hover:ring-amber-300"
                                        : "cursor-default"
                                }`}
                                style={{
                                    marginLeft: i > 0 ? "-4rem" : undefined,
                                    zIndex: reversed.length - i,
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
