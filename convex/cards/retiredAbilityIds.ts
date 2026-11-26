// Ability ids a retirement renamed (ADR 0114): when a hand-written card
// retires to its compiled twin, every activated and triggered ability takes
// the compiled twin's id. A stored position or move key (a Verdict is
// immutable, ADR 0128) keeps the hand-written id it was written with, so every
// reader of a stored id reads it through this one table: the scenario builder
// for a stack item's ability, the verdict candidate resolver for a move.
//
// Add a row only for an id a stored object names.

/** The hand-written twin's ability id → the compiled twin's. */
export const RETIRED_ABILITY_IDS: Readonly<Record<string, string>> = {
    "treetop-village-animate": "treetop-village-ability-2",
    "blazing-rootwalla-pump": "blazing-rootwalla-ability",
    "strip-mine-destroy": "strip-mine-ability-2",
    "trevas-ruins-etb": "treva-s-ruins-trigger",
};

/** `abilityId` as the live catalogue names it: its compiled twin's id when a
 *  retirement renamed it, else itself. */
export function currentAbilityId(abilityId: string): string {
    return Object.prototype.hasOwnProperty.call(RETIRED_ABILITY_IDS, abilityId)
        ? RETIRED_ABILITY_IDS[abilityId]
        : abilityId;
}
