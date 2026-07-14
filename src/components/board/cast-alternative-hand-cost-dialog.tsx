import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { CardInstance, Player } from "~/types/game";
import type { EffectCardFilter } from "@convex/cards/types";
import { getDefinition } from "@convex/cards";
import { getCardColors } from "@convex/cards/colors";
import GameDialog from "~/components/ui/game-dialog";
import CardImage from "~/components/cards/card-image";

type HandChoice = {
    action: "exile" | "discard";
    requirements: { filter: EffectCardFilter; count: number }[];
    excludeInstanceId: string;
};

/** Does a hand card match an `EffectCardFilter`? Reads the card's registry
 *  characteristics (types / subtypes / colours / name); every present field is
 *  ANDed, array fields OR within themselves. `any` (issue #897) is the one
 *  disjunctive clause list this filter supports — recurses through this same
 *  matcher — ANDed with every other top-level field present alongside it.
 *  Mirrors the server's `handCardMatchesFilter` (convex/gre/alternativeCost.ts)
 *  so eligibility shown client-side matches what the mutation will accept. */
function handCardMatches(
    card: CardInstance,
    filter: EffectCardFilter
): boolean {
    const def = getDefinition(card.card.id);
    const asArray = <T,>(v: T | T[] | undefined): T[] | undefined =>
        v === undefined ? undefined : Array.isArray(v) ? v : [v];
    if (filter.name !== undefined && def.name !== filter.name) return false;
    const types = asArray(filter.type);
    if (types !== undefined && !types.some((t) => def.types.includes(t)))
        return false;
    const excludeTypes = asArray(filter.excludeType);
    if (
        excludeTypes !== undefined &&
        excludeTypes.some((t) => def.types.includes(t))
    )
        return false;
    const subtypes = asArray(filter.subtype);
    if (
        subtypes !== undefined &&
        !subtypes.some((s) => (def.subtypes ?? []).includes(s))
    )
        return false;
    if (
        filter.supertype !== undefined &&
        !(def.supertypes ?? []).includes(filter.supertype)
    )
        return false;
    const colors = asArray(filter.color);
    if (colors !== undefined) {
        const cardColors = getCardColors(def);
        if (!colors.some((c) => cardColors.includes(c))) return false;
    }
    // issue #897 — OR ACROSS filter dimensions. A filter carrying ONLY `any`
    // must not fail open (match every hand card) — mirrors the server's
    // matching addition in `handCardMatchesFilter`.
    if (
        filter.any !== undefined &&
        !filter.any.some((clause) => handCardMatches(card, clause))
    )
        return false;
    return true;
}

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
                    disabled={isPending || selected.length !== total}
                    onClick={() => void handleConfirm()}
                    className="rounded-sm px-4 py-2 bg-accent hover:bg-accent-strong text-black font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                    {verb} {selected.length}/{total}
                </button>
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
