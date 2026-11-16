// dka — white cards (ADR 0043 colour split).
import { defineCard } from "../../types";

// ─────────────────────────────────────────────────────────────────────────
// Cost-modifier static effect (CR 601.2f, layer-agnostic — scanned at cast
// announcement)
// ─────────────────────────────────────────────────────────────────────────

// Thalia, Guardian of Thraben — {1}{W} Legendary Creature. "First strike.
// Noncreature spells cost {1} more to cast." Clause 1 is the `first-strike`
// keyword (CR 702.7, phases.ts combat-damage-step ordering). Clause 2 is a
// SYMMETRIC CR 601.2f cost increase — the Gloom (lea/black.ts) shape, which
// taxes any caster, NOT the Alabaster Leech / Aura of Silence shape whose
// predicate compares `card.controllerId` against `effectSource.controllerId`:
// Thalia's oracle text scopes to neither "you cast" nor "your opponents cast",
// so the tax applies to both players and the third `effectSource` argument
// goes unused. The predicate reads the cast card's live `types` (an artifact
// creature spell is a CREATURE spell and is exempt); lands are never spells
// (CR 305.1) so they never reach this site. Both the `cost-modifier` static
// and `first strike` are already exercised — no hand-written test required
// (per-Op regime, ADR 0046).
export const thaliaGuardianOfThraben = defineCard(() => ({
    id: "824423ff-6441-4be6-b754-810adf9ca6a2",
    rarity: "rare",
    name: "Thalia, Guardian of Thraben",
    oracleText: "First strike\nNoncreature spells cost {1} more to cast.",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    supertypes: ["Legendary"],
    power: 2,
    toughness: 1,
    staticAbilities: ["first strike"],
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToSpell: (card) => !card.types.includes("Creature"),
            costIncrease: { X: 1 },
        },
    ],
}));
