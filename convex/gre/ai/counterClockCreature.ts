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

/** Whether `perm` is on a counter clock: not a creature now, a creature card
 *  printed, its impending cost paid and a time counter still on it. The
 *  valuation does not read HOW MANY counters remain — see `evaluate.ts`. */
export function isCounterClockCreature(perm: CardInstanceState): boolean {
    if (isCreature(perm) || perm.impended !== true) return false;
    if ((perm.counters?.[TIME_COUNTER] ?? 0) <= 0) return false;
    const def = tryGetDefinition(String(perm.card.id ?? ""));
    return def?.types.includes("Creature") === true;
}

/** The view of `perm` as the creature it will be: its printed card types
 *  back, every other field as it stands. */
export function asEventualCreature(perm: CardInstanceState): CardInstanceState {
    const def = tryGetDefinition(String(perm.card.id ?? ""));
    return { ...perm, types: [...(def?.types ?? perm.types)] };
}
