import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { CardInstance, Player } from "~/types/game";
import type { Color } from "@convex/cards/types";
import { getDefinition } from "@convex/cards";
import { STATIC_EFFECT_CTX } from "@convex/gre/layers";
import { coverColoredAndHybridPips } from "@convex/gre/payWith";
import GameDialog from "~/components/ui/game-dialog";
import { Button } from "~/components/ui/button";
import CardImage from "~/components/cards/card-image";
import { PILE_GRID_TILE_W } from "~/lib/card-layout";
import { pickerRingClass } from "~/lib/picker-ring";

/** CR 702.51 (`payWith`, ADR 0063 — issue #1338) — the Convoke creature picker.
 *  Active when this player's `pendingCast` is waiting for them to tap creatures
 *  to pay a convoke cost (Hogaak). Each tapped creature pays for {1} OR one mana
 *  of that creature's colour (CR 702.51a), so a creature of the right colour can
 *  satisfy a guild-hybrid `{B/G}` pip. The player selects a SET of their own
 *  untapped creatures whose count is in `min..max` and whose colours cover the
 *  spell's coloured + hybrid pips, then submits via `selectConvokeCreatures`.
 *  Dismissing cancels the cast. Sibling of {@link CastExileCostDialog} (creatures
 *  on the battlefield rather than cards in the graveyard). */
export default function ConvokeCreatureDialog({
    choice,
    me,
    gameId,
    playerId,
}: {
    choice: {
        min: number;
        max: number;
        hybridPips: [Color, Color][];
        coloredPips?: Partial<Record<Color, number>>;
        pickedCreatureIds?: string[];
    };
    me: Player | undefined;
    gameId: Id<"games">;
    playerId: string;
}) {
    const selectConvokeCreatures = useMutation(api.game.selectConvokeCreatures);
    const cancelCast = useMutation(api.game.cancelCast);
    const [isPending, setIsPending] = useState(false);

    // CR 702.51a — eligible convoke fodder: the caster's OWN untapped creatures.
    const eligible = useMemo(
        () =>
            (me?.battlefield ?? []).filter(
                (card): card is CardInstance =>
                    card !== null &&
                    card.types?.includes("Creature") === true &&
                    card.isTapped !== true
            ),
        [me?.battlefield]
    );

    // A creature's live colours (CR 613.1d layer 5), routed through the SINGLE
    // authority the server (`recordConvokeCreaturePick`) and the bot
    // (`bot-view.ts`) validate coverage with — `STATIC_EFFECT_CTX.getColors`.
    // It already folds colorOverride, embedded/printed cost, and grantedColors,
    // so a continuous colour-change effect can't drift this client hint away
    // from what the server enforces (#1338 review — no third hand-rolled path).
    const creatureColors = useMemo(() => {
        const map = new Map<string, Set<Color>>();
        for (const card of eligible) {
            const colors = STATIC_EFFECT_CTX.getColors(
                card as Parameters<typeof STATIC_EFFECT_CTX.getColors>[0]
            );
            map.set(card.id, new Set<Color>(colors));
        }
        return map;
    }, [eligible]);

    // Arena-style prompt policy (ADR 0063): pre-seed a greedy covering set for
    // the FORCED pips so the caster only confirms (or swaps). Colour-match the
    // single-colour then hybrid pips to the least-flexible eligible creature.
    const [selected, setSelected] = useState<string[]>(() => {
        const used = new Set<string>();
        const pick = (pred: (c: Set<Color>) => boolean): string | undefined => {
            let bestId: string | undefined;
            let bestSize = Infinity;
            for (const card of eligible) {
                if (used.has(card.id)) continue;
                const colors = creatureColors.get(card.id) ?? new Set<Color>();
                if (pred(colors) && colors.size < bestSize) {
                    bestId = card.id;
                    bestSize = colors.size;
                }
            }
            if (bestId !== undefined) used.add(bestId);
            return bestId;
        };
        const seed: string[] = [];
        for (const [color, n] of Object.entries(choice.coloredPips ?? {})) {
            for (let i = 0; i < (n ?? 0); i++) {
                const id = pick((c) => c.has(color as Color));
                if (id) seed.push(id);
            }
        }
        for (const [c1, c2] of choice.hybridPips) {
            const id = pick((c) => c.has(c1) || c.has(c2));
            if (id) seed.push(id);
        }
        for (const card of eligible) {
            if (seed.length >= choice.min) break;
            if (!used.has(card.id)) {
                used.add(card.id);
                seed.push(card.id);
            }
        }
        return seed.slice(0, choice.max);
    });

    // The selection is legal when its count is in range AND its colours cover
    // the coloured + hybrid pips (the SAME greedy the server validates with).
    const requirementMet = useMemo(() => {
        if (selected.length < choice.min || selected.length > choice.max) {
            return false;
        }
        const sources = selected.map(
            (id) => creatureColors.get(id) ?? new Set<Color>()
        );
        return (
            coverColoredAndHybridPips(
                sources,
                choice.coloredPips ?? {},
                choice.hybridPips
            ) !== null
        );
    }, [selected, choice, creatureColors]);

    function toggle(cardId: string) {
        setSelected((prev) => {
            if (prev.includes(cardId)) {
                return prev.filter((id) => id !== cardId);
            }
            if (prev.length >= choice.max) return prev;
            return [...prev, cardId];
        });
    }

    async function handleCancel() {
        if (isPending) return;
        setIsPending(true);
        try {
            await cancelCast({ gameId, playerId });
        } finally {
            setIsPending(false);
        }
    }

    async function handleConfirm() {
        if (isPending || !requirementMet) return;
        setIsPending(true);
        try {
            await selectConvokeCreatures({
                gameId,
                playerId,
                creatureInstanceIds: selected,
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
            title="Convoke"
            subtitle={
                `Tap ${choice.min === choice.max ? choice.max : `${choice.min}–${choice.max}`} creature(s) you control — ` +
                `each pays for {1} or one mana of its color` +
                (choice.hybridPips.length > 0
                    ? ` (${choice.hybridPips.length} colored pip(s) must be covered)`
                    : "")
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
                            className={`relative ${PILE_GRID_TILE_W} aspect-5/7 rounded-sm overflow-hidden transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${pickerRingClass(isSel)}`}
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
                    disabled={isPending || !requirementMet}
                    onClick={() => void handleConfirm()}
                >
                    {`Tap ${selected.length}/${choice.max}`}
                </Button>
            </div>
        </GameDialog>
    );
}
