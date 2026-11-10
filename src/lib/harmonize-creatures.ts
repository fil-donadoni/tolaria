import type { EmblemInstance } from "@convex/cards/types";
import type { ContinuousEffect } from "@convex/gre/continuousEffects";
import type { CardInstance, Player } from "~/types/game";
import { effectivePower } from "~/lib/effective-stats";

/** CR 702.180a — the creatures the viewer may tap for a harmonize cast ("up to
 *  one untapped creature you control"), each with its live layer-7 power, the
 *  amount it would take off the generic part of the cost. Strongest first, so
 *  the picker leads with the largest reduction. Mirrors the server's
 *  `harmonizeEligibleCreatures` (`convex/gre/harmonize.ts`); `announceCast`
 *  re-validates the pick, so this only shapes the affordance (ADR 0074). */
export function harmonizeCreatureOptions(game: {
    playerId: string;
    allPlayers: Player[];
    emblems?: EmblemInstance[];
    continuousEffects?: ContinuousEffect[];
}): { card: CardInstance; power: number }[] {
    const me = game.allPlayers.find((p) => p.id === game.playerId);
    return (me?.battlefield ?? [])
        .filter(
            (c): c is CardInstance =>
                c !== null &&
                c.types?.includes("Creature") === true &&
                c.isTapped !== true
        )
        .map((card) => ({
            card,
            power: effectivePower(
                game.allPlayers,
                card,
                game.emblems,
                game.continuousEffects
            ),
        }))
        .sort((a, b) => b.power - a.power);
}
