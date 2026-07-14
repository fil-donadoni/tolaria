// Cards permanently declared out of scope by ADR 0010 (ante & subgames) or
// unimplementable by CR 712 (manual dexterity — Chaos Orb), keyed by Scryfall
// id (their `CardDefinition.id` — every stub below is commented out in its
// `convex/cards/sets/**` module for exactly this reason). Mirrors the
// `OLD_SCHOOL_BANNED` documentation-guard pattern in `convex/formats.ts`.
//
// The Booster Config importer (`scripts/import-booster-config.ts`) strips
// these ids from every print sheet at import time and renormalizes sheet
// weights, so `computeDraftability` (ADR 0056) never counts them as a
// completeness gap — they are treated as absent from the print run, not as
// "not implemented yet". A set otherwise fully implemented (LEA) is
// Draftable precisely because these four are the ONLY cards missing from its
// registry, and this list is the reason why that's fine.
export const ADR_EXCLUDED_SCRYFALL_IDS: ReadonlySet<string> = new Set([
    "9853b0ce-4763-4877-9741-f9145a3659c6", // Contract from Below (LEA) — ante, ADR 0010
    "e78db688-93a2-47f5-9aa5-9158a72cd973", // Darkpact (LEA) — ante, ADR 0010
    "fd891fc6-d9d6-494e-ae65-8bea8f44b575", // Demonic Attorney (LEA) — ante, ADR 0010
    "92274971-7c4a-4326-b0fe-75e2d124f718", // Chaos Orb (LEA) — dexterity, CR 712 / ADR 0010
]);
