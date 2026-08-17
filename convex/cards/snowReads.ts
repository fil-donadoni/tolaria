// Snow supertype reads (CR 205.4a) — the cycle-free LEAF module card sets use.
//
// In the Ice Age block "snow" is referenced only by type ("a snow-covered
// land", "sacrifice a snow Mountain"); the {S} snow-mana symbol is a later
// (Coldsnap) addition that ICE never uses (see CONTEXT.md "Snow"). These reads
// resolve the LIVE snow status of a permanent: printed supertypes (from the
// registry via the injected `supertypesForCardId` — cycle-free, mirrors
// `manaCostForCardId`) overlaid by any `supertype-set` static effect or
// indefinite `setSupertype` mutation (Melting / Arcum's Weathervane) recorded
// on the instance's `grantedSupertypes` / `removedSupertypes`.
//
// This module imports ONLY a type plus the cycle-free `supertypeLookup`
// accessor, so it has no runtime import edge back to the registry — a card set
// may value-import it safely (unlike `gre/snow`, which pulls the registry and
// would re-enter `index.ts` mid-build, a TDZ hazard).

import { supertypesForCardId } from "./supertypeLookup";

/** Minimal shape both `CardInstanceState` and the predicate state views satisfy:
 *  a card-def reference plus the instance supertype-mutation markers. */
export interface SupertypeView {
    types?: readonly string[];
    subtypes?: readonly string[];
    card?: ({ id?: string } & Record<string, unknown>) | undefined;
    grantedSupertypes?: readonly { supertype: string; sourceId: string }[];
    removedSupertypes?: readonly { supertype: string; sourceId: string }[];
}

/** Printed supertypes of a permanent (CR 205.4a). An embedded `supertypes` on
 *  the (copied / tokenized) card reference wins; else resolve via the injected
 *  registry lookup. */
function printedSupertypes(card: SupertypeView): readonly string[] {
    if (!card.card) return [];
    const embedded = (card.card as { supertypes?: string[] }).supertypes;
    if (embedded) return embedded;
    const id = card.card.id;
    return id ? (supertypesForCardId(id) ?? []) : [];
}

/** Live supertype status of a permanent (CR 205.4a): printed supertypes minus
 *  any removed by a `supertype-set` static / indefinite mutation, plus any
 *  added the same way. */
export function hasSupertypeLive(
    card: SupertypeView,
    supertype: string
): boolean {
    if ((card.grantedSupertypes ?? []).some((g) => g.supertype === supertype)) {
        return true;
    }
    if ((card.removedSupertypes ?? []).some((r) => r.supertype === supertype)) {
        return false;
    }
    return printedSupertypes(card).includes(supertype);
}

/** True if the permanent is currently a snow permanent (CR 205.4a). */
export function hasSnowSupertype(card: SupertypeView): boolean {
    return hasSupertypeLive(card, "Snow");
}

/** True if `card` is a snow Land right now. */
export function isSnowLand(card: SupertypeView): boolean {
    return (card.types ?? []).includes("Land") && hasSnowSupertype(card);
}

/** Number of snow lands on `battlefield` (CR 205.4a). Used by snow-count CDA
 *  P/T, damage amounts and activation gates. */
export function countSnowLands(battlefield: readonly SupertypeView[]): number {
    let n = 0;
    for (const perm of battlefield) {
        if (isSnowLand(perm)) n += 1;
    }
    return n;
}

/** True if `battlefield` contains a snow land of the given basic subtype
 *  (snow Swamp, snow Mountain, snow Forest). Used by snow landwalk
 *  (CR 702.14) and snow-subtype activation gates. */
export function controlsSnowSubtype(
    battlefield: readonly SupertypeView[],
    subtype: string
): boolean {
    return battlefield.some(
        (perm) => isSnowLand(perm) && (perm.subtypes ?? []).includes(subtype)
    );
}

/** Live supertypes of a permanent (CR 205.4a) for the `supertypes` field of a
 *  `PermanentFilter` — injected as `FilterMatchContext.supertypesOf`. */
export function liveSupertypesOf(card: SupertypeView): readonly string[] {
    const result = new Set<string>(printedSupertypes(card));
    for (const r of card.removedSupertypes ?? []) result.delete(r.supertype);
    for (const g of card.grantedSupertypes ?? []) result.add(g.supertype);
    return [...result];
}
