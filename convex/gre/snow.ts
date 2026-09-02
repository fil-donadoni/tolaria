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

/** Mutable instance shape `applyIndefiniteSupertypeMutation` writes: the
 *  layer-4 supertype LEDGER (PRD #2064 S4). `grantedSupertypes` /
 *  `removedSupertypes` are `syncLayers2to5`'s derived output and are NOT
 *  written here — a ledger row that also wrote the output would be overwritten
 *  by the next sync and read as a lost mutation. */
interface MutableSupertypeInstance {
    supertypeHolds?: {
        add?: string[];
        remove?: string[];
        seq: number;
    }[];
}

/** Adds (`present: true`) or removes (`present: false`) a supertype on a single
 *  permanent indefinitely (CR 205.4a — Arcum's Weathervane). Appends one row to
 *  the layer-4 supertype ledger; the derivation replays the rows in CR 613.7
 *  timestamp order, so a later toggle simply outranks an earlier one and no
 *  "clear the opposite marker" bookkeeping is needed — that reconciliation
 *  existed only because the markers were the authority. */
export function applyIndefiniteSupertypeMutation(
    card: MutableSupertypeInstance,
    supertype: string,
    present: boolean,
    /** CR 613.7 — the layer timestamp of this mutation, minted by the caller
     *  (which is the one holding the `GameState`). */
    seq: number
): void {
    card.supertypeHolds = [
        ...(card.supertypeHolds ?? []),
        present ? { add: [supertype], seq } : { remove: [supertype], seq },
    ];
}
