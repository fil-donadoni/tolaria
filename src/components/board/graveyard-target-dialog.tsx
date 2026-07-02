import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingTarget, Player } from "~/types/game";
import { getDefinition } from "@convex/cards";
import { getEligibleGraveyards } from "~/lib/graveyard-targets";
import GameDialog from "~/components/ui/game-dialog";
import GraveyardChoiceDialog from "./graveyard-choice-dialog";
import GraveyardCardPicker from "./graveyard-card-picker";

/** Graveyard target dialog (issue #314). When a pending target lives in the
 *  graveyard zone (CR 109.2 / 400.7), this dialog opens automatically and lets
 *  the chooser pick a card without hunting through the board piles.
 *
 *  Flow:
 *   - Computes the eligible graveyards (those holding ≥1 legal card) via the
 *     client mirror of the backend filter — `getLegalTargets` filtering is
 *     unchanged.
 *   - When ≥2 graveyards are eligible (`controller: "any"`, both non-empty), a
 *     graveyard-choice step ("My graveyard" / "Opponent's graveyard") precedes
 *     the card picker. With a single eligible graveyard the choice is skipped.
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
}: {
    pendingTarget: PendingTarget;
    me: Player | undefined;
    allPlayers: Player[];
    gameId: Id<"games">;
    playerId: string;
}) {
    const selectTarget = useMutation(api.game.selectTarget);
    const cancelTarget = useMutation(api.game.cancelTarget);
    const [isPending, setIsPending] = useState(false);
    const [chosenGraveyardId, setChosenGraveyardId] = useState<string | null>(
        null
    );

    const eligible = useMemo(
        () => getEligibleGraveyards(pendingTarget, allPlayers, playerId),
        [pendingTarget, allPlayers, playerId]
    );

    const cardInHand = me?.hand.find(
        (c) => c !== null && c.id === pendingTarget.cardInstanceId
    );
    const cardName = cardInHand
        ? getDefinition(cardInHand.card.id).name
        : "spell";

    // A single eligible graveyard skips the choice step entirely; ≥2 requires
    // the chooser to pick a graveyard first.
    const needsChoice = eligible.length > 1 && chosenGraveyardId === null;
    const activeGraveyard =
        eligible.length === 1
            ? eligible[0]
            : (eligible.find((g) => g.playerId === chosenGraveyardId) ?? null);

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
            subtitle={
                needsChoice
                    ? "Choose a graveyard"
                    : "Choose a card from the graveyard"
            }
            size="wide"
            dismissable={!isPending}
        >
            {needsChoice ? (
                <GraveyardChoiceDialog
                    graveyards={eligible}
                    isPending={isPending}
                    onSelect={(id) => setChosenGraveyardId(id)}
                />
            ) : activeGraveyard ? (
                <GraveyardCardPicker
                    cards={activeGraveyard.cards}
                    isPending={isPending}
                    onPick={handlePick}
                />
            ) : null}
        </GameDialog>
    );
}
