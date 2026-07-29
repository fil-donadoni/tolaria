import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { CardInstance, Player } from "~/types/game";
import type { Color } from "@convex/cards/types";
import { getDefinition } from "@convex/cards";
import { isExileCostEligible } from "@convex/cards/exileCostEligibility";
import GameDialog from "~/components/ui/game-dialog";
import CardImage from "~/components/cards/card-image";
import { PILE_GRID_TILE_W } from "~/lib/card-layout";

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
        /** CR 702.66 (Delve) — the `payWith` VARIABLE-OFFSET cost (CR 601.2g,
         *  ADR 0063): exile ANY number of graveyard cards in `min..max`, each
         *  paying for {1} of the spell's generic cost. When set, `count` is
         *  ignored. `min` > 0 means the caster's mana can't cover the shortfall
         *  — that many exiles are forced, and are pre-seeded below. */
        offsetGeneric?: { min: number; max: number };
    };
    me: Player | undefined;
    gameId: Id<"games">;
    playerId: string;
}) {
    const selectExileCost = useMutation(api.game.selectCastExileCost);
    const cancelCast = useMutation(api.game.cancelCast);
    const [isPending, setIsPending] = useState(false);

    // CR 702.34a / 118.5 — the cost cards come from the caster's own graveyard
    // (default, Flash of Insight) or hand (`zone: "hand"`, the exile-a-card-
    // from-hand flashback cost).
    const zone = choice.zone ?? "graveyard";
    const sourceCards = zone === "hand" ? me?.hand : me?.graveyard;

    // Eligible payment cards: the caster's own zone, matching the colour
    // filter (CR 105.2) and excluding the flashback card itself (CR 702.34e)
    // via the shared `isExileCostEligible` — the server (`recordCastExileCostPick`,
    // through `graveyardCardMatchesColor`, which delegates its colour leg
    // straight to this function) and the bot's view builder
    // (`buildCastExileChoiceView`) both call the SAME function, so the three
    // can never drift apart (issue #1659).
    const eligible = useMemo(
        () =>
            (sourceCards ?? []).filter(
                (card): card is CardInstance =>
                    card !== null &&
                    isExileCostEligible(
                        card,
                        choice.excludeInstanceId,
                        choice.color
                    )
            ),
        [sourceCards, choice.color, choice.excludeInstanceId]
    );

    // Arena-style prompt policy (ADR 0063): a partly-forced delve
    // (`offsetGeneric.min > 0`) opens with the FORCED MINIMUM already selected,
    // so the caster only has to confirm (or swap which cards pay). Seeded once,
    // at mount, from the front of the graveyard — the picker's bounds are fixed
    // for the life of the parked cast, so there is nothing to re-sync.
    const [selected, setSelected] = useState<string[]>(() =>
        eligible
            .slice(0, Math.max(0, choice.offsetGeneric?.min ?? 0))
            .map((c) => c.id)
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
    // CR 702.66 — Delve: a bounded free-count selection, distinct from the
    // Nethergoyf card-type threshold above.
    const offset = choice.offsetGeneric;
    const isDelve = offset !== undefined;
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
    const requirementMet = isDelve
        ? selected.length >= offset.min && selected.length <= offset.max
        : isVariable
          ? selectedTypeCount >= (choice.minCardTypes ?? 0)
          : selected.length === choice.count;

    function toggle(cardId: string) {
        setSelected((prev) => {
            if (prev.includes(cardId))
                return prev.filter((id) => id !== cardId);
            // Delve caps at `max`; the fixed cost caps at `count`; the
            // Nethergoyf card-type cost has no cap.
            if (isDelve && prev.length >= offset.max) return prev;
            if (!isDelve && !isVariable && prev.length >= choice.count)
                return prev;
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
            title={
                isDelve
                    ? "Delve"
                    : isVariable
                      ? "Escape cost"
                      : "Flashback cost"
            }
            subtitle={
                isDelve
                    ? `Exile up to ${offset.max} card(s) from your graveyard — each pays for {1}` +
                      (offset.min > 0
                          ? ` (at least ${offset.min} required)`
                          : "")
                    : isVariable
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
                            className={`relative ${PILE_GRID_TILE_W} aspect-5/7 rounded-sm overflow-hidden ring-1 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
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
                    {isDelve
                        ? `Exile ${selected.length}/${offset.max}`
                        : isVariable
                          ? `Exile ${selected.length} (${selectedTypeCount}/${choice.minCardTypes} types)`
                          : `Exile ${selected.length}/${choice.count}`}
                </button>
            </div>
        </GameDialog>
    );
}
