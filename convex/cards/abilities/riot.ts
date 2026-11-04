// Riot (CR 702.136a) — "You may have this permanent enter with an additional
// +1/+1 counter on it. If you don't, it gains haste." A card declares only
// `staticAbilities: ["riot"]`.
//
// The clause is a replacement effect (CR 614.1c), so it expands here, at the
// `getDefinition` seam (ADR 0054), into an `entersWith.asEnters` choice: a
// copiable declaration (CR 707.2) every entry path already reads. The haste is
// no reading of the keyword afterwards: a declined answer becomes an indefinite
// grant as the permanent enters (`applyDeclinedEntryKeywords`, `gre/state.ts`),
// so it outlives riot and a later "loses all abilities" removes it.
//
// CR 702.136b — each instance works separately: one clause per declared
// instance, so a double riot can take the counter and the haste.

import type { AsEntersChoice, CardDefinition } from "../types";

const RIOT_KEYWORD = "riot";

const RIOT_CLAUSE: AsEntersChoice = {
    kind: "mayEnterWithCounters",
    counterType: "+1/+1",
    count: 1,
    declinedKeyword: "haste",
};

const isRiotClause = (clause: AsEntersChoice): boolean =>
    clause.kind === RIOT_CLAUSE.kind &&
    clause.declinedKeyword === RIOT_CLAUSE.declinedKeyword;

/** Adds one CR 702.136a entry clause per declared instance of riot, after any
 *  "as it enters" clause the card declares itself. Returns the input unchanged
 *  without the keyword; never mutates it; idempotent. */
export function expandRiot(def: CardDefinition): CardDefinition {
    const instances =
        def.staticAbilities?.filter((a) => a === RIOT_KEYWORD).length ?? 0;
    const asEnters = def.entersWith?.asEnters ?? [];
    const missing = instances - asEnters.filter(isRiotClause).length;
    if (missing <= 0) return def;
    return {
        ...def,
        entersWith: {
            ...def.entersWith,
            asEnters: [...asEnters, ...Array(missing).fill(RIOT_CLAUSE)],
        },
    };
}
