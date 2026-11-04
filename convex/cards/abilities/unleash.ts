// Unleash (CR 702.98a) — "You may have this permanent enter with an additional
// +1/+1 counter on it" and "This permanent can't block as long as it has a
// +1/+1 counter on it." A card declares only `staticAbilities: ["unleash"]`.
//
// The first ability is a replacement effect (CR 614.1c), so it expands here,
// at the `getDefinition` seam (ADR 0054), into an `entersWith.asEnters` choice:
// a copiable declaration (CR 707.2) every entry path already reads. The second
// is read off the instance by `validateBlockerEligibility` (`gre/combat.ts`).

import type { AsEntersChoice, CardDefinition } from "../types";

const UNLEASH_KEYWORD = "unleash";

const UNLEASH_CLAUSE: AsEntersChoice = {
    kind: "mayEnterWithCounters",
    counterType: "+1/+1",
    count: 1,
};

/** Adds the CR 702.98a entry clause to a definition carrying `unleash`, after
 *  any "as it enters" clause the card declares itself. Returns the input
 *  unchanged without the keyword; never mutates it; idempotent. */
export function expandUnleash(def: CardDefinition): CardDefinition {
    if (!def.staticAbilities?.includes(UNLEASH_KEYWORD)) return def;
    const asEnters = def.entersWith?.asEnters ?? [];
    if (asEnters.some((c) => c.kind === UNLEASH_CLAUSE.kind)) return def;
    return {
        ...def,
        entersWith: {
            ...def.entersWith,
            asEnters: [...asEnters, UNLEASH_CLAUSE],
        },
    };
}

/** CR 702.98a — "This permanent can't block as long as it has a +1/+1 counter
 *  on it." Read off the live object: a counter from any source counts, and a
 *  permanent that lost unleash (CR 613.1f) is free to block. The one predicate
 *  the server's block validation and the board's blocker affordance share. */
export function unleashForbidsBlock(permanent: {
    staticAbilities?: readonly string[];
    counters?: Readonly<Record<string, number>>;
}): boolean {
    return (
        (permanent.staticAbilities?.includes(UNLEASH_KEYWORD) ?? false) &&
        (permanent.counters?.["+1/+1"] ?? 0) > 0
    );
}
