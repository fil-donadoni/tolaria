// mrd — blue cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";
import { affinityForArtifacts } from "../../abilities/affinity";

// Thoughtcast — {4}{U} Sorcery (MRD 54). "Affinity for artifacts (This spell
// costs {1} less to cast for each artifact you control.) Draw two cards."
// Modern Scryfall oracle text is authoritative (ADR 0004).
//
// First consumer of the Affinity KEYWORD (CR 702.41, PRD #702 / ADR 0063) —
// `affinityForArtifacts()` spreads BOTH the board-visible `staticAbilities`
// reminder string and the `selfCostReduction` that enforces it, so the two can
// never drift. Enforcement is entirely pre-existing engine infra (see
// `convex/cards/abilities/affinity.ts`): `getCostModifiers` reads
// `selfCostReduction` at the CR 601.2f self-host apply site.
//
// Thoughtcast is the card that proves the reduction is GENERIC-ONLY: no matter
// how many artifacts are on the battlefield, the `{U}` pip survives (702.41a
// reduces by {1}, a generic symbol) — `applyCostModifiers` only ever touches
// `manaCost.X`.
export const thoughtcast: CardDefinition = {
    id: "efb965a7-877a-4302-b507-25b0a9e32d9b", // MRD 54
    name: "Thoughtcast",
    rarity: "common",
    oracleText:
        "Affinity for artifacts (This spell costs {1} less to cast for each artifact you control.)\nDraw two cards.",
    manaCost: { X: 4, U: 1 },
    types: ["Sorcery"],
    ...affinityForArtifacts(),
    effects: [{ op: "draw", player: "controller", count: 2 }],
};
