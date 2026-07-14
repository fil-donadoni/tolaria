// Booster Config data model (ADR 0055/0056). A Booster Config is checked-in
// repo data describing a Draftable Set's real pack structure: weighted print
// sheets plus one or more weighted booster "recipes" that draw a fixed count
// of cards from named sheets. Cards are addressed by Scryfall id (the same
// id space `CardDefinition.id` / `CardPrint.printId` use), never by the raw
// MTGJSON UUID — see `mtgjsonImport.ts` for the UUID → Scryfall id mapping
// that produces this shape.
//
// Foil and variant slots do not exist here: the importer drops every foil
// print sheet and every booster variant that references one (ADR 0056 —
// "foilness does not exist in the engine").

/** A weighted print sheet: Scryfall id → relative pull weight. `totalWeight`
 *  is the sum of `cards`' weights, kept in sync by the importer so a reader
 *  never has to recompute it (renormalized after any card is stripped). */
export interface BoosterSheet {
    cards: Record<string, number>;
    totalWeight: number;
}

/** One weighted "recipe" for assembling a pack: `contents` maps a sheet name
 *  (a key of `BoosterConfig.sheets`) to how many cards to draw from it. A
 *  Booster Config can carry several variants (e.g. MTGJSON's foil-slot
 *  variants before they are dropped); `weight` is this variant's share of
 *  `BoosterConfig.boostersTotalWeight`. */
export interface BoosterVariant {
    contents: Record<string, number>;
    weight: number;
}

/** A set's complete Booster Config: everything `generateBooster` needs to
 *  sample one pack, and everything `computeDraftability` needs to check
 *  every printable card resolves to an implemented `CardDefinition`. */
export interface BoosterConfig {
    /** Lowercase set code, e.g. "lea". */
    setCode: string;
    /** Sum of `boosters[].weight` — kept in sync by the importer. */
    boostersTotalWeight: number;
    boosters: BoosterVariant[];
    sheets: Record<string, BoosterSheet>;
}
