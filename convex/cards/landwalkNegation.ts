// Shared, frontend-safe scan for battlefield-wide landwalk-negation statics
// (CR 509.1b / 702.14) — Great Wall, Undertow (LEG #484).
//
// Lives under `convex/cards/` (NOT `convex/gre/`) so the React client can call
// it directly to keep its block-eligibility view (`isLandwalkUnblockable`) in
// sync with the server's keyword-evasion pass (`combatRegistry.ts`), while the
// GRE and the bot's move enumeration call it server-side.
//
// A `landwalk-negation` static declared by ANY permanent ("creatures with
// X-walk can be blocked as though they didn't have X-walk") suppresses the
// evasion that OTHER creatures' landwalk would otherwise grant — the symmetric
// analogue of how `global-attack-restriction` (Moat) scans all permanents and
// forbids attacks by a filtered set. The negation lives with whoever controls
// the source; in practice the defending player, whose battlefield the landwalk
// evasion rule already scans, so scanning that same battlefield is enough.

import { tryGetDefinition } from ".";

/** Minimal permanent shape the scan needs. Both `CardInstanceState` (server)
 *  and the client's `CardInstance` satisfy this structurally. */
interface LandwalkNegationPermanent {
    card: { id?: string };
}

/** Returns the set of land subtypes whose landwalk evasion is currently
 *  negated on `battlefield` (CR 509.1b / 702.14). A creature with `X-walk`
 *  whose land subtype is in this set can be blocked as though it didn't have
 *  the keyword, regardless of the defender's lands.
 *
 *  Scans the defending player's battlefield — the only side that can host a
 *  landwalk-negation source affecting evasion against its own would-be
 *  blockers (the source's controller is the defender). */
export function negatedLandwalkSubtypes(
    battlefield: ReadonlyArray<LandwalkNegationPermanent>
): ReadonlySet<string> {
    const negated = new Set<string>();
    for (const perm of battlefield) {
        const cardId = perm.card?.id;
        if (!cardId) continue;
        const def = tryGetDefinition(cardId);
        if (!def?.staticEffects) continue;
        for (const effect of def.staticEffects) {
            if (effect.kind !== "landwalk-negation") continue;
            for (const subtype of effect.subtypes) negated.add(subtype);
        }
    }
    return negated;
}

/** Minimal land-permanent shape a supertype scan needs. `CardInstanceState`
 *  (server) and the client's `CardInstance` both satisfy it: `types` is the
 *  live array (so animated lands still count), `card.id` resolves the printed
 *  supertypes through the registry. */
interface LandSupertypePermanent {
    types?: ReadonlyArray<string>;
    card: { id?: string };
}

/** True if `battlefield` contains a Land whose printed supertypes include
 *  `supertype` (CR 205.4). Backs supertype-keyed landwalk ("legendary landwalk",
 *  Livonya Silone, LEG) — the attacker can't be blocked while the defending
 *  player controls a land with the named supertype (CR 702.14). Supertypes live
 *  on the card definition (not a text-changeable, instance-mutable field), so we
 *  resolve them through the registry — the same frontend-safe lookup pattern as
 *  `negatedLandwalkSubtypes`, keeping the client's block view in sync with the
 *  server's keyword-evasion pass. */
export function controlsLandWithSupertype(
    battlefield: ReadonlyArray<LandSupertypePermanent>,
    supertype: string
): boolean {
    return battlefield.some((perm) => {
        if (!perm.types?.includes("Land")) return false;
        const cardId = perm.card?.id;
        if (!cardId) return false;
        const def = tryGetDefinition(cardId);
        return def?.supertypes?.includes(supertype as never) ?? false;
    });
}
