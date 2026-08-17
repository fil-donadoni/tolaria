// Snow supertype reads + supertype mutation (CR 205.4a, 702.14 snow landwalk).
//
// The pure READ helpers live in the cycle-free leaf `cards/snowReads` (so card
// sets can value-import them without re-entering the registry build); this
// module re-exports them for engine consumers and adds the imperative
// supertype-mutation helper used by `SpellContext.setSupertype` (Arcum's
// Weathervane). See `cards/snowReads` for the read semantics.

export {
    hasSupertypeLive,
    hasSnowSupertype,
    isSnowLand,
    countSnowLands,
    controlsSnowSubtype,
    liveSupertypesOf,
} from "../cards/snowReads";
export type { SupertypeView } from "../cards/snowReads";

/** Mutable instance shape `applyIndefiniteSupertypeMutation` writes. */
interface MutableSupertypeInstance {
    grantedSupertypes?: { supertype: string; sourceId: string }[];
    removedSupertypes?: { supertype: string; sourceId: string }[];
}

const INDEFINITE = "indefinite";

/** Adds (`present: true`) or removes (`present: false`) a supertype on a single
 *  permanent indefinitely (CR 205.4a — Arcum's Weathervane). Writes the
 *  source-keyed markers `hasSupertypeLive` reads, using the `"indefinite"`
 *  sentinel source. Adding clears a prior indefinite removal of the same
 *  supertype (and vice versa) so toggling is consistent and idempotent. */
export function applyIndefiniteSupertypeMutation(
    card: MutableSupertypeInstance,
    supertype: string,
    present: boolean
): void {
    const dropFrom = (
        list: { supertype: string; sourceId: string }[] | undefined
    ) =>
        (list ?? []).filter(
            (e) => !(e.sourceId === INDEFINITE && e.supertype === supertype)
        );

    if (present) {
        const removed = dropFrom(card.removedSupertypes);
        card.removedSupertypes = removed.length > 0 ? removed : undefined;
        const granted = dropFrom(card.grantedSupertypes);
        granted.push({ supertype, sourceId: INDEFINITE });
        card.grantedSupertypes = granted;
    } else {
        const granted = dropFrom(card.grantedSupertypes);
        card.grantedSupertypes = granted.length > 0 ? granted : undefined;
        const removed = dropFrom(card.removedSupertypes);
        removed.push({ supertype, sourceId: INDEFINITE });
        card.removedSupertypes = removed;
    }
}
