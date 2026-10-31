// A COUNTER-CLOCK creature: a permanent that is not a creature now but becomes
// one, with no further decision, when a counter clock runs out — Impending's
// "not a creature" window (CR 702.176a: "as long as this permanent's
// impending cost was paid and it has a time counter on it, it's not a
// creature"; one counter leaves at each of its controller's end steps).
//
// The evaluator needs the distinction because the body is REAL, only late: a
// non-creature reading prices an impending Overlord at its abilities alone, so
// casting it for its impending cost read as throwing a 5/5 away, and the Bot
// passed instead (issue #1970).

import { tryGetDefinition } from "../../cards";
import { isCreature } from "../constants";
import type { CardInstanceState } from "../state";

/** CR 702.176a — the counter type Impending counts down. */
const TIME_COUNTER = "time";

/** How many of its controller's turns `perm` is from being a creature, or
 *  `null` when it is not on a counter clock (already a creature, or a
 *  non-creature that never becomes one). */
export function counterClockTurns(perm: CardInstanceState): number | null {
    if (isCreature(perm) || perm.impended !== true) return null;
    const remaining = perm.counters?.[TIME_COUNTER] ?? 0;
    if (remaining <= 0) return null;
    const def = tryGetDefinition(String(perm.card.id ?? ""));
    if (!def?.types.includes("Creature")) return null;
    return remaining;
}

/** The view of `perm` as the creature it will be: its printed card types
 *  back, every other field as it stands. */
export function asEventualCreature(perm: CardInstanceState): CardInstanceState {
    const def = tryGetDefinition(String(perm.card.id ?? ""));
    return { ...perm, types: [...(def?.types ?? perm.types)] };
}
