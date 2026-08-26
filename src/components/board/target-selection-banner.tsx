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
import { V4_CHIP } from "~/lib/board-chrome-v4";
import DivideTargetList from "./divide-target-list";

/** How the target COUNT reads on the prompt's chip.
 *
 *  The v4 prototype showed a "2 legal" chip — the number of legal targets still
 *  on the board. That number is **not on the wire**: `PendingTarget` carries the
 *  target FILTERS (colour / subtype / power / …), never a resolved candidate
 *  list.
 *
 *  It is NOT barred by ADR 0074 (a round-2 review corrected this note's first
 *  version, which claimed it was). The client already re-derives target
 *  legality every render — `matchesTargetRequirement` +
 *  `matchesPermanentTargetFilters` (`card-utils.ts`) are what make a card
 *  clickable, and they run through the SAME shared filter registry the server
 *  uses (ADR 0068), so they are not a drifting copy. ADR 0074 bars client
 *  AUTHORITY, not a client-side display count.
 *
 *  The real reason the chip counts PROGRESS instead is coverage: a legal-target
 *  count has to span players, the stack and graveyards, and the client's sweep
 *  is permanent-only — `hasBattlefieldTargetCandidate` (`card-utils.ts`)
 *  explicitly FAILS OPEN on `player` / `spell` / `spell-or-permanent` / `card`
 *  and on any non-battlefield `zone`. A chip reading "2 legal" while silently
 *  counting only one of four target spaces is worse than no chip. What the
 *  prompt DOES know exactly, for every requirement shape, is the player's
 *  progress against it (CR 601.2c), so that is what the chip says. Recorded
 *  deviation, issue #2727. */
function targetCountLabel(
    count: PendingTarget["count"],
    selected: number
): string {
    if (typeof count === "number") return `${selected} / ${count}`;
    if (count.max !== undefined) return `${selected} / up to ${count.max}`;
    return `${selected} / ${count.min}+`;
}

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
                        {/* v4 (ADR 0103 §4): the SOURCE in the display face,
                            the instruction as a quiet muted line under it —
                            the player reads "what am I aiming" first and "how
                            many of what" second. */}
                        <div className="flex min-w-0 flex-col gap-1">
                            <span className="truncate text-display text-base text-text">
                                {cardName}
                            </span>
                            <span className="text-xs text-text-muted">
                                {divide.active
                                    ? `Divide ${divide.kind === "prevent" ? "prevented damage" : "damage"} — ${divide.remaining} left`
                                    : hint}
                            </span>
                        </div>
                        {!divide.active && (
                            <span
                                data-target-count-chip
                                className={`${V4_CHIP} border-signal-target/60 tabular-nums text-signal-target-strong`}
                            >
                                {targetCountLabel(
                                    pendingTarget.count,
                                    pendingTarget.selected.length
                                )}
                            </span>
                        )}
                        {divide.active ? (
                            // CR 601.2d — divide-as-you-choose: each target below
                            // carries its own [−] N [+] stepper (dialed independently);
                            // this finalizes once the whole budget is assigned. Label
                            // follows `divide.kind` — Pollen Remedy's budget is
                            // PREVENTED damage (CR 615.1), not dealt (QA — this used
                            // to hard-code "Deal damage" for every divide spell).
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
                                {divide.kind === "prevent"
                                    ? "Prevent damage"
                                    : "Deal damage"}
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
