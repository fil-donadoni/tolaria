// dka — white cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Lingering Souls — {2}{W} Sorcery. "Create two 1/1 white Spirit creature
// tokens with flying." with Flashback {1}{B} (CR 702.34 — cast from the
// graveyard for the flashback cost, then exile it). The token creation is a
// plain DSL `createToken` (CR 111 / 707.2) with `count: 2`; the tokens enter
// with flying via `staticAbilities`. Flashback is the engine capability
// (convex/gre/flashback.ts); the `flashback` field carries the alternative,
// off-colour cost — the DKA gold-standard "cast it white, flash it back black".
export const lingeringSouls: CardDefinition = {
    id: "891a92d7-9ccf-4de1-8286-aa5254f27ba9",
    rarity: "uncommon",
    name: "Lingering Souls",
    oracleText:
        "Create two 1/1 white Spirit creature tokens with flying.\nFlashback {1}{B}",
    manaCost: { X: 2, W: 1 },
    types: ["Sorcery"],
    flashback: { X: 1, B: 1 },
    effects: [
        {
            op: "createToken",
            controller: "controller",
            count: 2,
            token: {
                name: "Spirit",
                types: ["Creature"],
                subtypes: ["Spirit"],
                power: 1,
                toughness: 1,
                colors: ["W"],
                staticAbilities: ["flying"],
            },
        },
    ],
};

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
export const thaliaGuardianOfThraben: CardDefinition = {
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
};
