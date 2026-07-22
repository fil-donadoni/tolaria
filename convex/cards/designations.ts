// State designations modeled like emblems (issue #1199, #1305). A designation
// is a game-state status a player holds — the Monarch (CR 725) and the City's
// Blessing (CR 702.131 Ascend) — rendered with a single canonical printed
// MARKER-card art, exactly the way an emblem carries `EmblemDefinition.
// imagePrintId` (resolved to a Scryfall image by `src/lib/images.ts`, with a
// text placeholder fallback).
//
// Unlike a token (whose art is a PER-CARD association keyed by the producing
// card in `token-prints.json`), a designation has ONE canonical marker art
// regardless of which card granted it — Scryfall prints a single marker card
// per designation. So this is a fixed registry keyed by designation id, the
// direct analogue of the emblem registry (`convex/cards/emblems.ts`), not a
// per-source-card association.
//
// This is pure display data (no closures / engine imports), so both the engine
// and the client import it freely. Monarch storage/behaviour lives in the GRE
// (`GameState.monarchId`); City's Blessing has no gameplay yet (the `ascend`
// keyword is unimplemented) — its entry is registered ahead of the mechanic so
// the art model is ready when Ascend ships.

export interface StateDesignationDefinition {
    /** Stable designation key (also the `CardPreview` cardId slot). */
    id: string;
    /** Marker-card display name. */
    name: string;
    /** Reminder text shown in the hover / zoom preview. */
    text: string;
    /** Scryfall print id of the marker card (layout `token`), resolved to an
     *  image URL by the shared `src/lib/images.ts` helpers. */
    imagePrintId: string;
}

/** CR 725 — The Monarch. Art: the "The Monarch" marker (Commander Masters
 *  printing `tcmm`). */
export const MONARCH_DESIGNATION: StateDesignationDefinition = {
    id: "monarch",
    name: "The Monarch",
    text: "You are the monarch.\nAt the beginning of your end step, draw a card.\nWhenever a creature deals combat damage to you, its controller becomes the monarch.",
    imagePrintId: "0cd9c491-6ba0-4484-822c-73bcbe9b0c49",
};

/** CR 702.131 — City's Blessing. Art: the "City's Blessing" marker (Rivals of
 *  Ixalan printing `trix`). Registered ahead of the Ascend mechanic (no
 *  gameplay yet). */
export const CITY_BLESSING_DESIGNATION: StateDesignationDefinition = {
    id: "city-blessing",
    name: "City's Blessing",
    text: "You have the city's blessing for as long as you control ten or more permanents.",
    imagePrintId: "ba64ed3e-93c5-406f-a38d-65cc68472122",
};

/** Registry keyed by designation id — the analogue of the emblem registry.
 *  Read by the stack UI (`stack-row.tsx`) to render a source-less designation
 *  triggered ability (the Monarch's end-step draw) with its marker art. */
export const STATE_DESIGNATIONS: Record<string, StateDesignationDefinition> = {
    [MONARCH_DESIGNATION.id]: MONARCH_DESIGNATION,
    [CITY_BLESSING_DESIGNATION.id]: CITY_BLESSING_DESIGNATION,
};

/** Soft lookup of a state designation by id (undefined for an unknown key). */
export function tryGetStateDesignation(
    id: string | undefined
): StateDesignationDefinition | undefined {
    return id ? STATE_DESIGNATIONS[id] : undefined;
}
