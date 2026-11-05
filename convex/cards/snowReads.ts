// Snow supertype reads (CR 205.4a) — the cycle-free LEAF module card sets use.
//
// In the Ice Age block "snow" is referenced only by type ("a snow-covered
// land", "sacrifice a snow Mountain"); the {S} snow-mana symbol is a later
// (Coldsnap) addition that ICE never uses (see GLOSSARY.md "Snow"). These reads
// resolve the LIVE snow status of a permanent: printed supertypes (from the
// registry via the injected `supertypesForCardId` — cycle-free, mirrors
// `colorDefiningCostForCardId`) overlaid by any `supertype-set` static effect or
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
    faceDown?: boolean;
    copyExcept?: { additionalSupertypes?: readonly string[] };
    grantedSupertypes?: readonly { supertype: string; sourceId: string }[];
    removedSupertypes?: readonly { supertype: string; sourceId: string }[];
}

/** CR 707.9b — the supertypes an "except he's legendary in addition to his
 *  other types" copy effect left on this object: a copiable value the presented
 *  definition does not hold (CR 707.3 — a copy of the copy inherits them).
 *  Empty for a face-down object, whose stamp stays on the instance to apply
 *  again when it is turned face up (CR 708.2). */
export function copyExceptSupertypes(
    card: Pick<SupertypeView, "faceDown" | "copyExcept">
): readonly string[] {
    return card.faceDown ? [] : (card.copyExcept?.additionalSupertypes ?? []);
}

/** CR 205.4a / 707.9b — the layer-1 supertypes of a permanent whose presented
 *  definition the caller already holds: the printed ones plus the copy effect's
 *  clause. For the readers that look at the definition rather than the live
 *  overlay; {@link liveSupertypesOf} is this plus the layer-4 overlay. */
export function copiableSupertypesOf(
    def: { supertypes?: readonly string[] } | null | undefined,
    card: Pick<SupertypeView, "faceDown" | "copyExcept">
): string[] {
    return [
        ...new Set([...(def?.supertypes ?? []), ...copyExceptSupertypes(card)]),
    ];
}

/** Layer-1 supertypes of a permanent (CR 205.4a): an embedded `supertypes` on
 *  the (copied / tokenized) card reference wins over the injected registry
 *  lookup; a copy effect's clause joins either (CR 707.9b). */
function copiableSupertypes(card: SupertypeView): readonly string[] {
    if (!card.card) return [];
    const embedded = (card.card as { supertypes?: string[] }).supertypes;
    const id = card.card.id;
    return copiableSupertypesOf(
        { supertypes: embedded ?? (id ? supertypesForCardId(id) : undefined) },
        card
    );
}

/** Live supertype status of a permanent (CR 205.4a): copiable supertypes minus
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
    return copiableSupertypes(card).includes(supertype);
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
    const result = new Set<string>(copiableSupertypes(card));
    for (const r of card.removedSupertypes ?? []) result.delete(r.supertype);
    for (const g of card.grantedSupertypes ?? []) result.add(g.supertype);
    return [...result];
}
