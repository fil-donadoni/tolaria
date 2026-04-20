import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingTarget, Player } from "~/types/game";
import { getCardById } from "@convex/cards";
import { useDraggable } from "~/hooks/useDraggable";

const TARGET_LABEL: Record<string, string> = {
    Creature: "a creature",
    Artifact: "an artifact",
    Enchantment: "an enchantment",
    Land: "a land",
    Planeswalker: "a planeswalker",
    player: "a player",
    any: "any target",
    spell: "a spell on the stack",
};

function formatTargetLabel(targetType: string | string[]): string {
    const types = Array.isArray(targetType) ? targetType : [targetType];
    const labels = types
        .map((t) => TARGET_LABEL[t] ?? t.toLowerCase())
        .filter(Boolean);
    if (labels.length === 0) return "a target";
    if (labels.length === 1) return labels[0];
    return labels.slice(0, -1).join(", ") + " or " + labels[labels.length - 1];
}

function describeTargetProgress(
    count: PendingTarget["count"],
    selected: number,
    label: string
): { hint: string; minReached: boolean; maxReached: boolean } {
    if (typeof count === "number") {
        const remaining = count - selected;
        return {
            hint:
                remaining > 1
                    ? `select ${remaining} targets`
                    : `select ${label}`,
            minReached: selected >= count,
            maxReached: selected >= count,
        };
    }
    const minReached = selected >= count.min;
    const maxReached = count.max !== undefined && selected >= count.max;
    const boundsLabel =
        count.max !== undefined ? `up to ${count.max}` : "any number of";
    const hint = minReached
        ? `add more targets or press Done (${selected} selected)`
        : `select ${boundsLabel} ${label} (min ${count.min})`;
    return { hint, minReached, maxReached };
}

export default function TargetSelectionBanner({
    pendingTarget,
    me,
    gameId,
    playerId,
}: {
    pendingTarget: PendingTarget;
    me: Player | undefined;
    gameId: Id<"games">;
    playerId: string;
}) {
    const cancelTarget = useMutation(api.game.cancelTarget);
    const confirmTargets = useMutation(api.game.confirmTargets);
    const { offset, dragHandlers } = useDraggable();

    const cardInHand = me?.hand.find(
        (c) => c !== null && c.id === pendingTarget.cardInstanceId
    );
    const cardName = cardInHand
        ? getCardById(cardInHand.card.id).name
        : "spell";
    const targetLabel = formatTargetLabel(pendingTarget.targetType);
    const { hint, minReached, maxReached } = describeTargetProgress(
        pendingTarget.count,
        pendingTarget.selected.length,
        targetLabel
    );
    const showDone = typeof pendingTarget.count !== "number" && !maxReached;

    return (
        <div
            className="absolute top-1/2 left-1/2 z-50"
            style={{
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
            }}
        >
            <div
                {...dragHandlers}
                className="flex items-center gap-3 bg-amber-900/90 border border-amber-500/50 rounded-lg px-5 py-3 backdrop-blur-sm shadow-lg cursor-move select-none"
            >
                <div className="text-amber-200 text-sm font-medium">
                    <span className="text-white font-bold">{cardName}</span>
                    {" — "}
                    {hint}
                </div>
                {showDone && (
                    <button
                        disabled={!minReached}
                        onClick={() => confirmTargets({ gameId, playerId })}
                        className="ml-2 px-3 py-1 rounded text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white transition-colors cursor-pointer"
                    >
                        Done
                    </button>
                )}
                <button
                    onClick={() => cancelTarget({ gameId, playerId })}
                    className="ml-2 px-3 py-1 rounded text-xs font-bold bg-red-600 hover:bg-red-500 text-white transition-colors cursor-pointer"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}
