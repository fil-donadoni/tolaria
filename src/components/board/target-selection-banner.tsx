import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingTarget, Player, StackItem } from "~/types/game";
import { getDefinition, tryGetDefinition } from "@convex/cards";
import { tryGetEmblemDefinition } from "@convex/cards/emblems";
import { usePromptBannerPosition } from "~/hooks/usePromptBannerPosition";
import { useDivideBuffer } from "~/hooks/useDivideBuffer";
import { Panel } from "~/components/ui/panel";
import { Button } from "~/components/ui/button";
import {
    describeTargetProgress,
    formatTargetLabel,
} from "~/lib/target-progress";
import DivideTargetList from "./divide-target-list";

export default function TargetSelectionBanner({
    pendingTarget,
    me,
    stack,
    gameId,
    playerId,
}: {
    pendingTarget: PendingTarget;
    me: Player | undefined;
    stack: StackItem[];
    gameId: Id<"games">;
    playerId: string;
}) {
    const cancelTarget = useMutation(api.game.cancelTarget);
    const confirmTargets = useMutation(api.game.confirmTargets);
    const [isBusy, setIsBusy] = useState(false);
    // Issue #1813 — always pinned: the whole point of this banner is to
    // route taps to targets on the mid-board (CR 601.2c), so a vertically
    // centered panel would sit directly on top of what the player must tap.
    const { outerClassName, outerStyle, innerClassName, dragHandlers } =
        usePromptBannerPosition({ pinned: true });
    const divide = useDivideBuffer();

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
    // A triggered ability chooses its target as it goes on the stack (CR
    // 603.3d): `cardInstanceId` is the trigger's STACK-ITEM id. Resolve its
    // source name from the stack — card registry first, then the emblem
    // registry (an emblem-sourced trigger's `card.id` is an emblem KEY absent
    // from the card registry; without this the banner read the generic
    // "spell", the confusing label that led players to Cancel Chandra's emblem
    // trigger into a 0-damage resolve).
    const triggerSource =
        pendingTarget.kind === "trigger"
            ? stack.find((s) => s.id === pendingTarget.cardInstanceId)
            : undefined;
    const triggerSourceName = triggerSource
        ? (tryGetDefinition(triggerSource.card.id)?.name ??
          tryGetEmblemDefinition(triggerSource.card.id)?.name)
        : undefined;
    const cardName = cardInHand
        ? getDefinition(cardInHand.card.id).name
        : sourcePermanent
          ? getDefinition(sourcePermanent.card.id).name
          : (triggerSourceName ?? (isCopyRetarget ? "Copy" : "spell"));
    const targetLabel = formatTargetLabel(
        pendingTarget.targetType,
        pendingTarget.zone,
        pendingTarget.controller,
        pendingTarget.spellStackKind
    );
    const { hint, minReached, maxReached } = describeTargetProgress(
        pendingTarget.count,
        pendingTarget.selected.length,
        targetLabel
    );
    const showDone = typeof pendingTarget.count !== "number" && !maxReached;

    return (
        <div className={outerClassName} style={outerStyle}>
            {/* Drag chrome stays on a plain wrapper — Panel forwards no
                handlers, so the frame lives inside it. */}
            <div
                {...dragHandlers}
                className={`cursor-move select-none ${innerClassName}`.trim()}
            >
                <Panel
                    density="compact"
                    className="flex flex-col gap-3 px-5 py-3"
                >
                    <div className="flex items-center gap-3">
                        <div className="text-sm">
                            <span className="font-beleren tracking-wide text-parchment">
                                {cardName}
                            </span>
                            <br />
                            <span className="text-text-muted ml-2">
                                {divide.active
                                    ? `Divide damage — ${divide.remaining} left`
                                    : hint}
                            </span>
                        </div>
                        {divide.active ? (
                            // CR 601.2d — divide-as-you-choose: each target below
                            // carries its own [−] N [+] stepper (dialed independently);
                            // this "Deal damage" finalizes once the whole budget is
                            // assigned.
                            <Button
                                type="button"
                                variant="primary"
                                size="sm"
                                disabled={
                                    isBusy ||
                                    divide.isPending ||
                                    !divide.canSubmit
                                }
                                onClick={() => void divide.submit()}
                            >
                                Deal damage
                            </Button>
                        ) : (
                            showDone && (
                                <Button
                                    type="button"
                                    variant="primary"
                                    size="sm"
                                    disabled={isBusy || !minReached}
                                    onClick={async () => {
                                        if (isBusy) return;
                                        setIsBusy(true);
                                        try {
                                            await confirmTargets({
                                                gameId,
                                                playerId,
                                            });
                                        } finally {
                                            setIsBusy(false);
                                        }
                                    }}
                                >
                                    Done
                                </Button>
                            )
                        )}
                        <Button
                            type="button"
                            variant="destructive"
                            size="sm"
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
                        >
                            {isCopyRetarget ? "Keep targets" : "Cancel"}
                        </Button>
                    </div>
                    {divide.active && <DivideTargetList />}
                </Panel>
            </div>
        </div>
    );
}
