import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { CardInstance, Player } from "~/types/game";
import { getCardById } from "@convex/cards";
import GameDialog from "~/components/ui/game-dialog";
import CardImage from "~/components/cards/card-image";

/** Exile-from-graveyard activation-cost picker (FEM Night Soil, CR 602.1 /
 *  118.5 / 406). Active when this player's `pendingActivation` is waiting for
 *  them to pick the cards the exile cost requires. The whole cost must come
 *  from ONE graveyard (CR 118.5), so the player first picks a graveyard that
 *  holds enough matching cards, then selects EXACTLY `count` of them, then
 *  submits via `selectActivationExileCost`. Dismissing cancels the activation
 *  (parity with the payment banner's Cancel). */
export default function ExileCostDialog({
    choice,
    allPlayers,
    gameId,
    playerId,
}: {
    choice: { count: number; cardType?: string };
    allPlayers: Player[];
    gameId: Id<"games">;
    playerId: string;
}) {
    const selectExileCost = useMutation(api.game.selectActivationExileCost);
    const cancelActivation = useMutation(api.game.cancelActivation);
    const [isPending, setIsPending] = useState(false);
    const [chosenOwnerId, setChosenOwnerId] = useState<string | null>(null);
    const [selected, setSelected] = useState<string[]>([]);

    const matches = (card: CardInstance): boolean =>
        choice.cardType === undefined ||
        getCardById(card.card.id).types.includes(choice.cardType as never);

    // Graveyards that hold enough matching cards to pay the whole cost from one
    // pile (CR 118.5).
    const eligible = useMemo(
        () =>
            allPlayers
                .map((p) => ({
                    ownerId: p.id,
                    name: p.name,
                    cards: p.graveyard.filter(matches),
                }))
                .filter((g) => g.cards.length >= choice.count),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [allPlayers, choice.count, choice.cardType]
    );

    const needsOwnerChoice = eligible.length > 1 && chosenOwnerId === null;
    const activeGraveyard =
        eligible.length === 1
            ? eligible[0]
            : (eligible.find((g) => g.ownerId === chosenOwnerId) ?? null);

    async function handleCancel() {
        if (isPending) return;
        setIsPending(true);
        try {
            await cancelActivation({ gameId, playerId });
        } finally {
            setIsPending(false);
        }
    }

    function toggle(cardId: string) {
        setSelected((prev) => {
            if (prev.includes(cardId))
                return prev.filter((id) => id !== cardId);
            if (prev.length >= choice.count) return prev; // cap at count
            return [...prev, cardId];
        });
    }

    async function handleConfirm() {
        if (isPending || !activeGraveyard || selected.length !== choice.count) {
            return;
        }
        setIsPending(true);
        try {
            await selectExileCost({
                gameId,
                playerId,
                graveyardOwnerId: activeGraveyard.ownerId,
                cardInstanceIds: selected,
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
            title="Exile from a graveyard"
            subtitle={
                needsOwnerChoice
                    ? "Choose a graveyard"
                    : `Select ${choice.count} ${choice.cardType ?? "card"} card(s) to exile`
            }
            size="wide"
            dismissable={!isPending}
        >
            {needsOwnerChoice ? (
                <div className="flex flex-col gap-2 mt-2">
                    {eligible.map((g) => (
                        <button
                            key={g.ownerId}
                            type="button"
                            disabled={isPending}
                            onClick={() => setChosenOwnerId(g.ownerId)}
                            className="rounded-sm px-3 py-2 ring-1 ring-[#c8a060]/40 hover:ring-2 hover:ring-[#c8a060]/70 disabled:opacity-40 cursor-pointer text-left"
                        >
                            {g.ownerId === playerId
                                ? "Your graveyard"
                                : `${g.name}'s graveyard`}{" "}
                            ({g.cards.length})
                        </button>
                    ))}
                </div>
            ) : activeGraveyard ? (
                <>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-2">
                        {activeGraveyard.cards.map((card) => {
                            const isSel = selected.includes(card.id);
                            return (
                                <button
                                    key={card.id}
                                    type="button"
                                    disabled={isPending}
                                    onClick={() => toggle(card.id)}
                                    title={getCardById(card.card.id).name}
                                    className={`relative rounded-sm overflow-hidden ring-1 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                                        isSel
                                            ? "ring-2 ring-[#c8a060]"
                                            : "ring-transparent hover:ring-2 hover:ring-[#c8a060]/70"
                                    }`}
                                >
                                    <CardImage card={card} />
                                </button>
                            );
                        })}
                    </div>
                    <div className="mt-3 flex justify-end">
                        <button
                            type="button"
                            disabled={
                                isPending || selected.length !== choice.count
                            }
                            onClick={() => void handleConfirm()}
                            className="rounded-sm px-4 py-2 bg-[#c8a060]/80 hover:bg-[#c8a060] text-black font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        >
                            Exile {selected.length}/{choice.count}
                        </button>
                    </div>
                </>
            ) : null}
        </GameDialog>
    );
}
