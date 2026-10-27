import { getEffectiveColors } from "./effectiveColors";
import { matchesPermanentFilter, type PermanentFilter } from "./filters";
import type { PermanentView, TriggerStateView } from "./types";

/**
 * CR 109.5 — how many of `player`'s battlefield permanents `filter` matches,
 * counting no further than `cap` (a caller that only needs "at least N").
 * Reads the LIVE colours through the one authority every other colour read
 * uses. `self` is the source whose controller "you" names.
 *
 * The one count behind every board-state "controls" read off a
 * `TriggerStateView`: a trigger's intervening-if (`cards/compiledTriggers.ts`)
 * and an activated ability's `activationCondition`
 * (`gre/activationPrecondition.ts`), so the two never disagree on what a
 * permanent matches.
 */
export function countControlledMatching(
    player: TriggerStateView["players"][number],
    filter: PermanentFilter,
    self: PermanentView,
    cap = Infinity
): number {
    let matched = 0;
    for (const permanent of player.battlefield) {
        if (
            matchesPermanentFilter(
                {
                    id: permanent.id,
                    types: permanent.types,
                    subtypes: permanent.subtypes,
                    supertypes: permanent.supertypes,
                    staticAbilities: permanent.staticAbilities,
                    controllerId: permanent.controllerId,
                    isToken: permanent.isToken,
                    power: permanent.power,
                    toughness: permanent.toughness,
                    // CR 105.2 / 613.1e — the LIVE colours, through the one
                    // authority every other colour read uses. The engine hands
                    // this gate the raw game state, whose instances carry no
                    // `colors` field, so a colour clause ("if you control a
                    // blue or black permanent") would otherwise match nothing.
                    colors:
                        permanent.colors ??
                        getEffectiveColors(
                            permanent as unknown as PermanentView
                        ),
                },
                filter,
                {
                    selfInstanceId: self.id,
                    selfControllerId: self.controllerId,
                }
            )
        ) {
            matched += 1;
            if (matched >= cap) break;
        }
    }
    return matched;
}
