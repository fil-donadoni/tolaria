import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { CardInstance, Player } from "~/types/game";
import type { Color } from "@convex/cards/types";
import { getDefinition } from "@convex/cards";
import { getCardColors } from "@convex/cards/colors";
import GameDialog from "~/components/ui/game-dialog";
import CardImage from "~/components/cards/card-image";

/** Flashback "exile X <colour> cards from your graveyard" CAST-cost picker
 *  (CR 702.34a / 118.5 — Flash of Insight). Active when this player's
 *  `pendingCast` is waiting for them to pick the cards the flashback exile cost
 *  requires. The whole cost comes from the caster's OWN graveyard; the player
 *  selects EXACTLY `count` cards matching the `color` filter (CR 105.2), never
 *  the flashback card itself (`excludeInstanceId`, CR 702.34e), then submits via
 *  `selectCastExileCost`. Dismissing cancels the cast (parity with the payment
 *  banner's Cancel). Mirrors the activation-path `ExileCostDialog`. */
export default function CastExileCostDialog({
    choice,
    me,
    gameId,
    playerId,
}: {
    choice: {
        count: number;
        color?: Color;
        excludeInstanceId: string;
        zone?: "graveyard" | "hand";
        /** CR 702.138a (Nethergoyf escape) — variable exile cost: exile ANY
         *  number of other cards with ≥ this many distinct card types among
         *  them. When set, `count` is ignored. */
        minCardTypes?: number;
    };
    me: Player | undefined;
    gameId: Id<"games">;
    playerId: string;
}) {
    const selectExileCost = useMutation(api.game.selectCastExileCost);
    const cancelCast = useMutation(api.game.cancelCast);
    const [isPending, setIsPending] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);

    // CR 702.34a / 118.5 — the cost cards come from the caster's own graveyard
    // (default, Flash of Insight) or hand (`zone: "hand"`, the exile-a-card-
    // from-hand flashback cost).
    const zone = choice.zone ?? "graveyard";
    const sourceCards = zone === "hand" ? me?.hand : me?.graveyard;

    // Eligible payment cards: the caster's own zone, matching the colour
    // filter (CR 105.2), excluding the flashback card itself (CR 702.34e).
    const eligible = useMemo(
        () =>
            (sourceCards ?? []).filter(
                (card): card is CardInstance =>
                    card !== null &&
                    card.id !== choice.excludeInstanceId &&
                    (choice.color === undefined ||
                        getCardColors(getDefinition(card.card.id)).includes(
                            choice.color
                        ))
            ),
        [sourceCards, choice.color, choice.excludeInstanceId]
    );

    async function handleCancel() {
        if (isPending) return;
        setIsPending(true);
        try {
            await cancelCast({ gameId, playerId });
        } finally {
            setIsPending(false);
        }
    }

    // CR 702.138a — the variable escape cost (Nethergoyf) takes ANY number of
    // cards as long as their combined DISTINCT card types reach `minCardTypes`;
    // the fixed cost (Flashback, Uro/Phlage escape) takes EXACTLY `count`.
    const isVariable = choice.minCardTypes !== undefined;
    const selectedTypeCount = useMemo(() => {
        if (!isVariable) return 0;
        const types = new Set<string>();
        for (const id of selected) {
            const card = eligible.find((c) => c.id === id);
            if (card) {
                for (const t of getDefinition(card.card.id).types) types.add(t);
            }
        }
        return types.size;
    }, [isVariable, selected, eligible]);
    const requirementMet = isVariable
        ? selectedTypeCount >= (choice.minCardTypes ?? 0)
        : selected.length === choice.count;

    function toggle(cardId: string) {
        setSelected((prev) => {
            if (prev.includes(cardId))
                return prev.filter((id) => id !== cardId);
            // Fixed cost caps at `count`; the variable cost has no cap.
            if (!isVariable && prev.length >= choice.count) return prev;
            return [...prev, cardId];
        });
    }

    async function handleConfirm() {
        if (isPending || !requirementMet) return;
        setIsPending(true);
        try {
            await selectExileCost({
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
            title={isVariable ? "Escape cost" : "Flashback cost"}
            subtitle={
                isVariable
                    ? `Exile any number of cards with ${choice.minCardTypes}+ card types among them (${selectedTypeCount} selected)`
                    : `Exile ${choice.count} ${choice.color === "U" ? "blue " : ""}card(s) from your ${zone}`
            }
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
                    disabled={isPending || !requirementMet}
                    onClick={() => void handleConfirm()}
                    className="rounded-sm px-4 py-2 bg-accent hover:bg-accent-strong text-black font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                    {isVariable
                        ? `Exile ${selected.length} (${selectedTypeCount}/${choice.minCardTypes} types)`
                        : `Exile ${selected.length}/${choice.count}`}
                </button>
            </div>
        </GameDialog>
    );
}
