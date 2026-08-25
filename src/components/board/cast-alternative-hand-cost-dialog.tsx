import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { CardInstance, Player } from "~/types/game";
import type { EffectCardFilter } from "@convex/cards/types";
import { getDefinition } from "@convex/cards";
import { matchesHandCardFilter as handCardMatches } from "~/lib/card-utils";
import GameDialog from "~/components/ui/game-dialog";
import { Button } from "~/components/ui/button";
import CardImage from "~/components/cards/card-image";
import { PILE_GRID_TILE_W } from "~/lib/card-layout";
import { pickerRingClass } from "~/lib/picker-ring";

type HandChoice = {
    action: "exile" | "discard";
    requirements: { filter: EffectCardFilter; count: number }[];
    excludeInstanceId: string;
};

/** ALTERNATIVE-cost HAND-leg picker (CR 118.9 — Force of Will's "exile a blue
 *  card", Foil's "discard an Island card and another card"). Active when this
 *  player's `pendingCast` is waiting for them to pick the cards the alternative
 *  cost's hand leg requires. The player selects cards from their hand (never the
 *  cast card itself) covering every requirement, then submits via
 *  `selectCastAlternativeHandCost`. Dismissing cancels the cast (parity with the
 *  payment banner). Mirrors {@link CastExileCostDialog}. */
export default function CastAlternativeHandCostDialog({
    choice,
    me,
    gameId,
    playerId,
}: {
    choice: HandChoice;
    me: Player | undefined;
    gameId: Id<"games">;
    playerId: string;
}) {
    const submit = useMutation(api.game.selectCastAlternativeHandCost);
    const cancelCast = useMutation(api.game.cancelCast);
    const [isPending, setIsPending] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);

    const total = choice.requirements.reduce((a, r) => a + r.count, 0);

    // Eligible payment cards: the caster's hand, matching AT LEAST ONE
    // requirement filter (union), excluding the cast card itself. The server
    // re-validates the full per-requirement distinct match.
    const eligible = useMemo(
        () =>
            (me?.hand ?? []).filter(
                (card): card is CardInstance =>
                    card !== null &&
                    card.id !== choice.excludeInstanceId &&
                    choice.requirements.some((r) =>
                        handCardMatches(card, r.filter)
                    )
            ),
        [me?.hand, choice.excludeInstanceId, choice.requirements]
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

    function toggle(cardId: string) {
        setSelected((prev) => {
            if (prev.includes(cardId))
                return prev.filter((id) => id !== cardId);
            if (prev.length >= total) return prev; // cap at required total
            return [...prev, cardId];
        });
    }

    async function handleConfirm() {
        if (isPending || selected.length !== total) return;
        setIsPending(true);
        try {
            await submit({ gameId, playerId, cardInstanceIds: selected });
        } finally {
            setIsPending(false);
        }
    }

    const verb = choice.action === "exile" ? "Exile" : "Discard";
    const subtitle = choice.requirements
        .map((r) => describeRequirement(r))
        .join(" and ");

    return (
        <GameDialog
            open
            onOpenChange={(open) => {
                if (!open) void handleCancel();
            }}
            title="Alternative cost"
            subtitle={`${verb} ${subtitle} from your hand`}
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
                            className={`relative ${PILE_GRID_TILE_W} aspect-5/7 overflow-hidden transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${pickerRingClass(isSel)}`}
                        >
                            <CardImage card={card} />
                        </button>
                    );
                })}
            </div>
            <div className="mt-3 flex justify-end">
                <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={isPending || selected.length !== total}
                    onClick={() => void handleConfirm()}
                >
                    {verb} {selected.length}/{total}
                </Button>
            </div>
        </GameDialog>
    );
}

/** Human-readable label for a single hand-cost requirement (e.g. "a blue card",
 *  "an Island card", "another card"). */
function describeRequirement(req: {
    filter: EffectCardFilter;
    count: number;
}): string {
    const f = req.filter;
    if (f.subtype !== undefined) {
        const s = Array.isArray(f.subtype) ? f.subtype.join("/") : f.subtype;
        return `${req.count > 1 ? `${req.count} ` : "a"}${req.count > 1 ? "" : "n"} ${s} card${req.count > 1 ? "s" : ""}`.replace(
            "an ",
            /^[AEIOU]/.test(s) ? "an " : "a "
        );
    }
    if (f.color !== undefined) {
        const colorName: Record<string, string> = {
            W: "white",
            U: "blue",
            B: "black",
            R: "red",
            G: "green",
        };
        const c = Array.isArray(f.color) ? f.color[0] : f.color;
        const label = colorName[c] ?? "coloured";
        return `${req.count > 1 ? `${req.count} ` : "a "}${label} card${req.count > 1 ? "s" : ""}`;
    }
    return req.count > 1 ? `${req.count} cards` : "another card";
}
