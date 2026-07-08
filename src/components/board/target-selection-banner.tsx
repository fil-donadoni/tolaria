import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingTarget, Player } from "~/types/game";
import { getDefinition } from "@convex/cards";
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

    // CR 707.10b — a copy-retarget selection points at a spell copy on the
    // stack (not a card in hand); declining keeps the copy's inherited
    // targets, so the source line reads "Copy" and Cancel reads "Keep
    // targets" to convey the optionality.
    const isCopyRetarget = pendingTarget.kind === "copy-retarget";
    const cardInHand = me?.hand.find(
        (c) => c !== null && c.id === pendingTarget.cardInstanceId
    );
    // For an activated ability the source is a permanent on the battlefield,
    // not a card in hand (CR 602.1) — `cardInstanceId` is the permanent's id.
    // Resolve its name from the battlefield so the banner shows the ability's
    // source rather than the generic "spell" fallback.
    const sourcePermanent =
        pendingTarget.kind === "ability"
            ? me?.battlefield.find((c) => c.id === pendingTarget.cardInstanceId)
            : undefined;
    const cardName = cardInHand
        ? getDefinition(cardInHand.card.id).name
        : sourcePermanent
          ? getDefinition(sourcePermanent.card.id).name
          : isCopyRetarget
            ? "Copy"
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
            className="absolute top-1/2 left-1/2 z-100"
            style={{
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
            }}
        >
            <div
                {...dragHandlers}
                className="relative flex items-center gap-3 bg-surface border border-border-subtle backdrop-blur-md rounded-sm px-5 py-3 shadow-[0_0_50px_rgba(0,0,0,0.8)] cursor-move select-none"
            >
                <div className="absolute top-1.5 left-1.5 w-3 h-3 border-t border-l border-border-accent/40" />
                <div className="absolute top-1.5 right-1.5 w-3 h-3 border-t border-r border-border-accent/40" />
                <div className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b border-l border-border-accent/40" />
                <div className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b border-r border-border-accent/40" />

                <div className="text-sm">
                    <span className="font-beleren tracking-wide text-parchment">
                        {cardName}
                    </span>
                    <br />
                    <span className="text-text-muted ml-2">{hint}</span>
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
                        className="px-3 py-1 rounded-sm text-xs font-beleren tracking-wide bg-accent-soft border border-accent text-accent-strong hover:bg-accent-soft/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
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
                    className="px-3 py-1 rounded-sm text-xs font-beleren tracking-wide bg-danger-soft border border-danger text-danger-strong hover:bg-danger-soft/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                    {isCopyRetarget ? "Keep targets" : "Cancel"}
                </button>
            </div>
        </div>
    );
}
