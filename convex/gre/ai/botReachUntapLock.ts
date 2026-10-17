/**
 * What the Bot-play sweep puts on the OPPONENT's battlefield for a permanent
 * whose static ability stops lands untapping (CR 502.3, issue #5717).
 *
 * An untap lock takes its value from the mana it denies. Against an opponent
 * with no lands it denies nothing and still locks the holder's own, so passing
 * is right: the position used to hold no opposing land, and the card read
 * `never-chosen` — a limit of the harness, not a fact about the Bot. The board
 * learns the shape instead: the opponent's lands already TAPPED, the state in
 * which a lock bites (an untapped land keeps its one activation; a tapped one
 * is dead until something else untaps it).
 *
 * Lives beside `botReach.ts` for the same reason as its siblings: it decides
 * what the position CONTAINS, so it is a verdict input and sits inside the Bot
 * hash (`scripts/lib/oracle-bot-reach.ts`).
 */

import type { CardDefinition } from "../../cards/types";
import type { PermanentFilter } from "../../cards/filters";
import type { ScenarioCard } from "../../debugScenarioSpec";

/** The opposing lands posed, a full mana base for a mid-game opponent. */
const OPPOSING_LANDS = 4;

/** Does `filter` reach lands? An absent type list matches every permanent. */
function filterCoversLands(filter: PermanentFilter): boolean {
    return filter.types === undefined || filter.types.includes("Land");
}

/** The untap-step restriction filters a definition declares, authored
 *  (`staticEffects`) or compiled (`compiledStaticEffects`). */
function untapLockFilters(def: CardDefinition): PermanentFilter[] {
    const filters: PermanentFilter[] = [];
    for (const effect of def.staticEffects ?? [])
        if (
            effect.kind === "untap-restriction" &&
            !effect.appliesToHost &&
            !effect.appliesToSelf
        )
            filters.push(effect.filter);
    for (const effect of def.compiledStaticEffects ?? [])
        if (effect.kind === "untap-restriction") filters.push(effect.filter);
    return filters;
}

/** The tapped opposing lands the position hands a permanent that locks lands
 *  in the tapped state, or none. */
export function untapLockPose(def: CardDefinition): ScenarioCard[] {
    if (!untapLockFilters(def).some(filterCoversLands)) return [];
    return [
        {
            name: "Island",
            owner: "opp",
            zone: "battlefield",
            count: OPPOSING_LANDS,
            tapped: true,
        },
    ];
}
