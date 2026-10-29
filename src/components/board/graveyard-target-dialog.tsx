import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingTarget, Player } from "~/types/game";
import { getDefinition } from "@convex/cards";
import { getEligibleGraveyards } from "~/lib/graveyard-targets";
import GameDialog from "~/components/ui/game-dialog";
import GraveyardTabs from "./graveyard-tabs";
import GraveyardCardPicker from "./graveyard-card-picker";
import {
    describeTargetProgress,
    formatTargetLabel,
} from "~/lib/target-progress";

/** Graveyard target dialog (issue #314). When a pending target lives in the
 *  graveyard zone (CR 109.2 / 400.7), this dialog opens automatically and lets
 *  the chooser pick a card without hunting through the board piles.
 *
 *  Flow:
 *   - Computes the eligible graveyards (those holding ≥1 legal card) via the
 *     client mirror of the backend filter — `getLegalTargets` filtering is
 *     unchanged.
 *   - When ≥2 graveyards are eligible (`controller: "any"`, both non-empty), a
 *     persistent tab strip ("My graveyard" / "Opponent's graveyard") stays above
 *     the card picker so the chooser can switch graveyards at any time without
 *     cancelling the spell (Arena parity). The first eligible graveyard is shown
 *     by default. With a single eligible graveyard the tabs are omitted.
 *   - Picking a card submits the `graveyard-card` target with the owning
 *     player's id (unchanged `selectTarget` contract).
 *   - Dismissing the dialog cancels target selection (parity with the banner's
 *     Cancel). Mutation-firing buttons disable while in flight. */
export default function GraveyardTargetDialog({
    pendingTarget,
    me,
    allPlayers,
    gameId,
    playerId,
    activePlayerId,
}: {
    pendingTarget: PendingTarget;
    me: Player | undefined;
    allPlayers: Player[];
    gameId: Id<"games">;
    playerId: string;
    /** CR 109.5 — the current active player (issue #1950 review round 2,
     *  BLOCKER 2), needed by `getEligibleGraveyards`'s delegated
     *  `checkCardTargetFilters` call for a `controller: "active"` filter. */
    activePlayerId: string;
}) {
    const selectTarget = useMutation(api.game.selectTarget);
    const cancelTarget = useMutation(api.game.cancelTarget);
    const [isPending, setIsPending] = useState(false);
    const [chosenGraveyardId, setChosenGraveyardId] = useState<string | null>(
        null
    );

    const eligible = useMemo(
        () =>
            getEligibleGraveyards(
                pendingTarget,
                allPlayers,
                playerId,
                activePlayerId
            ),
        [pendingTarget, allPlayers, playerId, activePlayerId]
    );

    const cardInHand = me?.hand.find(
        (c) => c !== null && c.id === pendingTarget.cardInstanceId
    );
    const cardName = cardInHand
        ? getDefinition(cardInHand.card.id).name
        : "spell";

    // Issue: dialog subtitle previously hardcoded singular "a card" even for
    // a 2-target spell like Restock, though the underlying selection count
    // was always correct. Mirror the banner's live remaining-count hint.
    const targetLabel = formatTargetLabel(
        pendingTarget.targetType,
        pendingTarget.zone,
        pendingTarget.controller,
        pendingTarget.spellStackKind
    );
    const { hint } = describeTargetProgress(
        pendingTarget.count,
        pendingTarget.selected.length,
        targetLabel
    );
    const subtitle = hint.charAt(0).toUpperCase() + hint.slice(1);

    // The active graveyard defaults to the first eligible one so its cards show
    // immediately; the tab strip (shown only when ≥2 are eligible) lets the
    // chooser switch at will without cancelling.
    const activeGraveyard =
        eligible.find((g) => g.playerId === chosenGraveyardId) ??
        eligible[0] ??
        null;

    async function handleCancel() {
        if (isPending) return;
        setIsPending(true);
        try {
            await cancelTarget({ gameId, playerId });
        } finally {
            setIsPending(false);
        }
    }

    async function handlePick(cardId: string) {
        if (isPending || !activeGraveyard) return;
        setIsPending(true);
        try {
            await selectTarget({
                gameId,
                playerId,
                targetType: "graveyard-card",
                targetId: cardId,
                targetPlayerId: activeGraveyard.playerId,
            });
        } finally {
            setIsPending(false);
        }
    }

    return (
        <GameDialog
            open
            onOpenChange={(open) => {
                if (!open) void handleCancel();
            }}
            title={cardName}
            subtitle={subtitle}
            size="wide"
            dismissable={!isPending}
        >
            {eligible.length > 1 && activeGraveyard && (
                <div className="mb-3">
                    <GraveyardTabs
                        graveyards={eligible}
                        activeId={activeGraveyard.playerId}
                        onSelect={(id) => setChosenGraveyardId(id)}
                        isPending={isPending}
                    />
                </div>
            )}
            {activeGraveyard ? (
                <GraveyardCardPicker
                    cards={activeGraveyard.cards}
                    isPending={isPending}
                    selectedIds={pendingTarget.selected
                        .filter((t) => t.type === "graveyard-card")
                        .map((t) => t.id)}
                    onPick={handlePick}
                />
            ) : null}
        </GameDialog>
    );
}
