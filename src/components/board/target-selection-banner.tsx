import { useState } from "react";
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
    "spell-or-permanent": "a spell or permanent",
    card: "a card",
};

function formatTargetLabel(
    targetType: string | string[],
    zone: PendingTarget["zone"],
    controller: PendingTarget["controller"]
): string {
    const types = Array.isArray(targetType) ? targetType : [targetType];
    const labels = types
        .map((t) => TARGET_LABEL[t] ?? t.toLowerCase())
        .filter(Boolean);
    let head: string;
    if (labels.length === 0) head = "a target";
    else if (labels.length === 1) head = labels[0];
    else
        head =
            labels.slice(0, -1).join(", ") + " or " + labels[labels.length - 1];
    if (zone === "graveyard") {
        const owner =
            controller === "you"
                ? "your graveyard"
                : controller === "opponent"
                  ? "your opponent's graveyard"
                  : "a graveyard";
        return `${head} from ${owner}`;
    }
    return head;
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
    const [isBusy, setIsBusy] = useState(false);
    const { offset, dragHandlers } = useDraggable();

    const cardInHand = me?.hand.find(
        (c) => c !== null && c.id === pendingTarget.cardInstanceId
    );
    const cardName = cardInHand
        ? getCardById(cardInHand.card.id).name
        : "spell";
    const targetLabel = formatTargetLabel(
        pendingTarget.targetType,
        pendingTarget.zone,
        pendingTarget.controller
    );
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
                className="relative flex items-center gap-3 bg-[#0c0d12]/90 border border-zinc-800/80 backdrop-blur-md rounded-sm px-5 py-3 shadow-[0_0_50px_rgba(0,0,0,0.8)] cursor-move select-none"
            >
                <div className="absolute top-1.5 left-1.5 w-3 h-3 border-t border-l border-zinc-500/40" />
                <div className="absolute top-1.5 right-1.5 w-3 h-3 border-t border-r border-zinc-500/40" />
                <div className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b border-l border-zinc-500/40" />
                <div className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b border-r border-zinc-500/40" />

                <div className="text-sm">
                    <span className="font-beleren tracking-wide text-[#f1f1e8]">
                        {cardName}
                    </span>
                    <br />
                    <span className="text-zinc-400 ml-2">{hint}</span>
                </div>
                {showDone && (
                    <button
                        disabled={isBusy || !minReached}
                        onClick={async () => {
                            if (isBusy) return;
                            setIsBusy(true);
                            try {
                                await confirmTargets({ gameId, playerId });
                            } finally {
                                setIsBusy(false);
                            }
                        }}
                        className="px-3 py-1 rounded-sm text-xs font-beleren tracking-wide bg-[#7a5a2e]/30 border border-[#c8a060]/45 text-[#e0c08a] hover:bg-[#7a5a2e]/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    >
                        Done
                    </button>
                )}
                <button
                    disabled={isBusy}
                    onClick={async () => {
                        if (isBusy) return;
                        setIsBusy(true);
                        try {
                            await cancelTarget({ gameId, playerId });
                        } finally {
                            setIsBusy(false);
                        }
                    }}
                    className="px-3 py-1 rounded-sm text-xs font-beleren tracking-wide bg-[#5c1e1e]/45 border border-[#a04040]/45 text-[#d48080] hover:bg-[#5c1e1e]/65 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}
