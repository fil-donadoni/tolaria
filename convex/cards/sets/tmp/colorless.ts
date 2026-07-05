// TMP — colorless cards, split by colour per ADR 0043. The registry's
// `import * as tmp from "./sets/tmp"` resolves through tmp/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { ActivatedAbilityContext, CardDefinition } from "../../types";
import { makeTapForMana } from "../../abilities";

// Ancient Tomb — "{T}: Add {C}{C}. This land deals 2 damage to you."
// (CR 605.1a mana ability, `useStack: false`.) The self-damage rides the
// `dealsDamageToControllerOnTap` rider (issue #675) — the unconditional
// sibling of the painland `dealsDamageToControllerOnColoredTap` rider,
// firing on EVERY tap regardless of the (here, always colorless) mana
// produced. Vintage Cube free tranche (issue #675, ADR 0041).
export const ancientTomb: CardDefinition = {
    id: "30e401e3-282b-4524-87e1-c6cd50cd6d00",
    rarity: "uncommon",
    name: "Ancient Tomb",
    oracleText: "{T}: Add {C}{C}. This land deals 2 damage to you.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            ...makeTapForMana({
                id: "ancient-tomb-mana",
                oracleText: "{T}: Add {C}{C}.",
                produces: { C: 2 },
            }),
            dealsDamageToControllerOnTap: 2,
        },
    ],
};

// Lotus Petal — "{T}, Sacrifice this artifact: Add one mana of any color."
// (CR 605.1a mana ability, `useStack: false`, CR 701.16 sacrifice cost.) The
// any-color choice follows the established Birds of Paradise / Talisman
// shape. Vintage Cube free tranche (issue #675, ADR 0041).
export const lotusPetal: CardDefinition = {
    id: "6c877da3-68fa-41d0-8a24-8c79fcd8ecc1",
    rarity: "common",
    name: "Lotus Petal",
    oracleText: "{T}, Sacrifice this artifact: Add one mana of any color.",
    manaCost: {},
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "lotus-petal-mana",
            oracleText:
                "{T}, Sacrifice this artifact: Add one mana of any color.",
            cost: { tap: true, sacrifice: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ W: 1 });
            },
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};

// Wasteland — "{T}: Add {C}.\n{T}, Sacrifice this land: Destroy target
// nonbasic land." (CR 701.26 tap mana ability; CR 701.16 sacrifice cost;
// CR 701.7 destroy.) "Nonbasic" needs a NEGATIVE supertype filter — the
// engine only had the positive `supertypeFilter` (Avalanche's "target snow
// lands"); this card motivates a small, general, orthogonal addition
// (`TargetRequirement.excludeSupertypes`, mirroring the existing
// `excludeTypes`/`excludeColors`/`excludeSubtypes` fields) rather than a
// card-shaped workaround.
export const wasteland: CardDefinition = {
    id: "99ff731b-8399-40c8-b539-ba6ba5783771",
    rarity: "uncommon",
    name: "Wasteland",
    oracleText:
        "{T}: Add {C}.\n{T}, Sacrifice this land: Destroy target nonbasic land.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "wasteland-mana",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 1 }),
            manaProduced: { C: 1 },
        },
        {
            id: "wasteland-destroy",
            oracleText:
                "{T}, Sacrifice this land: Destroy target nonbasic land.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: "Land",
                count: 1,
                excludeSupertypes: "Basic",
            },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};
