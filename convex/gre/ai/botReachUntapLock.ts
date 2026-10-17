/**
 * What the Bot-play sweep puts on the OPPONENT's battlefield for a permanent
 * that keeps every player's mana sources from untapping (CR 502.3, issue
 * #5747).
 *
 * A symmetric untap lock is worth what it takes from the OPPONENT's mana
 * minus what it takes from the holder's (`manaLockSourceWorth`,
 * `ai/restrictionPricing.ts`). On the empty opposing board of the generated
 * position it takes nothing from the opponent and the holder's own lands, just
 * tapped to pay for it, are locked dead: passing is right, and the card read
 * `never-chosen` — a limit of the harness, not a fact about the Bot. The board
 * learns the shape instead: a mid-game opponent who tapped out on their own
 * turn, so the lock keeps those lands tapped.
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import { tryGetDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import type { ScenarioCard } from "../../debugScenarioSpec";

/** The opposing lands posed, a full mana base for a mid-game opponent. */
const OPPOSING_LANDS = 4;

/** True for a permanent with an untap restriction that is neither host- nor
 *  self-scoped and reaches lands (a hard skip, or a cap below the lands
 *  posed). */
function locksLandUntap(def: CardDefinition): boolean {
    if (def.types.includes("Creature") || def.types.includes("Land"))
        return false;
    // A compiled definition carries its statics as descriptors; the registry
    // expands them (ADR 0054), so read the registered form.
    const live = tryGetDefinition(def.id) ?? def;
    return (live.staticEffects ?? []).some((effect) => {
        if (effect.kind !== "untap-restriction") return false;
        if (effect.appliesToHost || effect.appliesToSelf) return false;
        const types = effect.filter.types;
        const reachesLands =
            types === undefined ||
            (Array.isArray(types) ? types.includes("Land") : types === "Land");
        return reachesLands && effect.maxUntap < OPPOSING_LANDS;
    });
}

/** The tapped opposing lands the position hands a symmetric land untap lock,
 *  or none. */
export function untapLockPose(def: CardDefinition): ScenarioCard[] {
    if (!locksLandUntap(def)) return [];
    return [
        {
            name: "Island",
            owner: "opp",
            zone: "battlefield",
            tapped: true,
            count: OPPOSING_LANDS,
        },
    ];
}
