/**
 * The five Basic land subtypes, in WUBRG order (CR 305.2/305.6) — the single
 * canonical vocabulary for "which subtype is this", shared by:
 *
 * - `src/components/deckbuilder/basicLands.ts`, which re-exports this pair
 *   alongside its Pool-lookup helpers (`resolveBasicLandCardIds`,
 *   `isBasicLandCardId`) for the deckbuilder's Pool basic-lands bar.
 * - `src/lib/deckViewPrefs.ts`, which only needs the vocabulary (to type and
 *   validate a per-subtype art-preference key), not the Pool-lookup helpers,
 *   so it imports directly from here rather than through the component.
 *
 * Lives in `src/lib/` (not `convex/`) because it is a pure frontend/UI
 * vocabulary with no server-side consumer, and (not `src/components/`)
 * because `src/lib/` modules do not import from `src/components/` in this
 * codebase — components import from `lib`, never the reverse.
 */
export const BASIC_LAND_SUBTYPES = [
    "Plains",
    "Island",
    "Swamp",
    "Mountain",
    "Forest",
] as const;

export type BasicLandSubtype = (typeof BASIC_LAND_SUBTYPES)[number];
