import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingTarget, Player } from "~/types/game";

const TARGET_LABEL: Record<string, string> = {
    Creature: "a creature",
    Artifact: "an artifact",
    Enchantment: "an enchantment",
    Land: "a land",
    Planeswalker: "a planeswalker",
    player: "a player",
    any: "any target",
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

    const cardInHand = me?.hand.find(
        (c) => c.id === pendingTarget.cardInstanceId
    );
    const cardName = cardInHand?.card.name ?? "spell";
    const remaining = pendingTarget.count - pendingTarget.selected.length;
    const targetLabel = formatTargetLabel(pendingTarget.targetType);

    return (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50">
            <div className="flex items-center gap-3 bg-amber-900/90 border border-amber-500/50 rounded-lg px-5 py-3 backdrop-blur-sm shadow-lg">
                <div className="text-amber-200 text-sm font-medium">
                    <span className="text-white font-bold">{cardName}</span>
                    {" — select "}
                    {remaining > 1 ? `${remaining} targets` : targetLabel}
                </div>
                <button
                    onClick={() => cancelTarget({ gameId, playerId })}
                    className="ml-2 px-3 py-1 rounded text-xs font-bold bg-red-600 hover:bg-red-500 text-white transition-colors"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}
