import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { CardInstance, Player } from "~/types/game";
import type { EffectCardFilter } from "@convex/cards/types";
import { getDefinition } from "@convex/cards";
import { matchesHandCardFilter } from "~/lib/card-utils";
import GameDialog from "~/components/ui/game-dialog";
import CardImage from "~/components/cards/card-image";

/** "Discard a card matching <filter>" ACTIVATION-cost picker (CR 602.1 /
 *  118.3 — Survival of the Fittest "Discard a creature card"). Active when
 *  this player's `pendingActivation` is waiting for them to pick the card(s)
 *  the `discardFilter` cost requires — always an explicit choice, never
 *  auto-picked (mirrors `ExileCostDialog` / `sacrificeFilter`'s player-choice
 *  discipline). The player selects `count` matching cards from their OWN
 *  hand, then submits via `selectActivationDiscardCost`. Dismissing cancels
 *  the activation (parity with the payment banner's Cancel). */
export default function DiscardCostDialog({
    choice,
    me,
    gameId,
    playerId,
}: {
    choice: { filter: EffectCardFilter; count: number };
    me: Player | undefined;
    gameId: Id<"games">;
    playerId: string;
}) {
    const selectDiscardCost = useMutation(api.game.selectActivationDiscardCost);
    const cancelActivation = useMutation(api.game.cancelActivation);
    const [isPending, setIsPending] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);

    const eligible = useMemo(
        () =>
            (me?.hand ?? []).filter(
                (card): card is CardInstance =>
                    card !== null &&
                    matchesHandCardFilter(card, choice.filter)
            ),
        [me?.hand, choice.filter]
    );

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
        if (isPending || selected.length !== choice.count) return;
        setIsPending(true);
        try {
            await selectDiscardCost({
                gameId,
                playerId,
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
            title="Discard a card"
            subtitle={`Select ${choice.count} card(s) to discard`}
            size="wide"
            dismissable={!isPending}
        >
            <div className="flex flex-wrap justify-center gap-2 mt-2 p-1">
                {eligible.map((card) => {
                    const isSel = selected.includes(card.id);
                    return (
                        <button
                            key={card.id}
                            type="button"
                            disabled={isPending}
                            onClick={() => toggle(card.id)}
                            title={getDefinition(card.card.id).name}
                            className={`relative w-24 sm:w-28 aspect-5/7 rounded-sm overflow-hidden ring-1 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                                isSel
                                    ? "ring-2 ring-accent"
                                    : "ring-transparent hover:ring-2 hover:ring-accent"
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
                    disabled={isPending || selected.length !== choice.count}
                    onClick={() => void handleConfirm()}
                    className="rounded-sm px-4 py-2 bg-accent hover:bg-accent-strong text-black font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                    Discard {selected.length}/{choice.count}
                </button>
            </div>
        </GameDialog>
    );
}
