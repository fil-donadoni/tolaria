// `expandEchoCumulativeUpkeep` — the ADR 0054 `getDefinition` expander for the
// two upkeep-cost keywords declared as typed cost fields (ADR 0155):
// `echo: <cost>` (CR 702.30a) and `cumulativeUpkeep: <cost>` (CR 702.24a).
//
// The field is the declaration; the trigger is derived from it by the existing
// factories (`echoTrigger`, `cumulativeUpkeepTrigger`), with the prompt's cost
// label derived from the cost (`upkeepCostLabel`). Ability ids are the
// keyword's own ("echo", "cumulative-upkeep"): one instance per card.

import type { CardDefinition, TriggeredAbility } from "../types";
import { cumulativeUpkeepTrigger } from "./cumulativeUpkeep";
import { echoTrigger } from "./echo";
import { upkeepCostLabel, upkeepKeywordLine } from "./upkeepCostLabel";

export const ECHO_ABILITY_ID = "echo";
export const CUMULATIVE_UPKEEP_ABILITY_ID = "cumulative-upkeep";

/** Returns the definition with the upkeep trigger(s) its `echo` /
 *  `cumulativeUpkeep` fields name. Unchanged (same object) when neither field is
 *  declared. Never mutates the input. Idempotent: a trigger id already present
 *  is not injected again. */
export function expandEchoCumulativeUpkeep(
    def: CardDefinition
): CardDefinition {
    if (def.echo === undefined && def.cumulativeUpkeep === undefined) {
        return def;
    }
    const existing = def.triggeredAbilities ?? [];
    const injected: TriggeredAbility[] = [];
    if (
        def.echo !== undefined &&
        !existing.some((t) => t.id === ECHO_ABILITY_ID)
    ) {
        injected.push(
            echoTrigger({
                cost: def.echo,
                costLabel: upkeepCostLabel(def.echo),
                keywordLine: upkeepKeywordLine("Echo", def.echo),
            })
        );
    }
    if (
        def.cumulativeUpkeep !== undefined &&
        !existing.some((t) => t.id === CUMULATIVE_UPKEEP_ABILITY_ID)
    ) {
        injected.push(
            cumulativeUpkeepTrigger({
                cost: def.cumulativeUpkeep,
                costLabel: upkeepCostLabel(def.cumulativeUpkeep),
                keywordLine: upkeepKeywordLine(
                    "Cumulative upkeep",
                    def.cumulativeUpkeep
                ),
            })
        );
    }
    if (injected.length === 0) return def;
    return { ...def, triggeredAbilities: [...existing, ...injected] };
}
