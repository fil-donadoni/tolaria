// ody — green cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";
import { AURA_AFFECTS_HOST, EFFECT_AFFECTS_SELF } from "../../types";
import { tokenPrintIdFor } from "../../tokenPrintLookup";

const SQUIRREL_NEST_ID = "22eccb27-1723-4c5a-96b8-85e6e5739c30";

// Squirrel Nest — {1}{G}{G} Enchantment — Aura. "Enchant land. Enchanted land
// has '{T}: Create a 1/1 green Squirrel creature token.'" The Forbidden Lore /
// Earthlore shape (ice/green.ts): an Aura on any land whose whole effect is an
// `activated-grant` StaticEffect (CR 611.2a / 613.1f) pushing ONE activated
// ability onto the enchanted land. `AURA_AFFECTS_HOST` scopes the grant to the
// land this Aura is attached to; the template lives on `grantTemplates[]` so
// Squirrel Nest itself exposes nothing. The cost is the LAND's own tap
// (`cost.tap`, CR 602.1) and the effect is the spec-driven `createToken` Op
// (CR 111 / 701.7) — the 1/1 green Squirrel spec Deep Forest Hermit already
// uses (nem/green.ts). "Enchant land" carries no controller clause, so it may
// sit on an opponent's land (that land's controller activates).
export const squirrelNest: CardDefinition = {
    id: SQUIRREL_NEST_ID,
    name: "Squirrel Nest",
    rarity: "uncommon",
    oracleText:
        'Enchant land\nEnchanted land has "{T}: Create a 1/1 green Squirrel creature token."',
    manaCost: { X: 1, G: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    staticEffects: [
        {
            kind: "activated-grant",
            applies: AURA_AFFECTS_HOST,
            abilityId: "squirrel-nest-make-squirrel",
        },
    ],
    grantTemplates: [
        {
            id: "squirrel-nest-make-squirrel",
            oracleText: "{T}: Create a 1/1 green Squirrel creature token.",
            cost: { tap: true },
            useStack: true,
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Squirrel",
                        types: ["Creature"],
                        subtypes: ["Squirrel"],
                        power: 1,
                        toughness: 1,
                        colors: ["G"],
                        imagePrintId: tokenPrintIdFor(
                            SQUIRREL_NEST_ID,
                            "Squirrel"
                        ),
                    },
                    controller: "controller",
                    count: 1,
                },
            ],
        },
    ],
};

const CALL_OF_THE_HERD_ID = "429a88cc-53db-4c5e-a061-f0f49a38c675";

// Call of the Herd — {2}{G} Sorcery. "Create a 3/3 green Elephant creature
// token." plus "Flashback {3}{G}" (CR 702.34a — the graveyard cast pays the
// flashback cost instead of the mana cost and exiles the card as it leaves the
// stack; the whole keyword is engine infra, `convex/gre/flashback.ts`, driven
// by the `flashback` printed-cost field, exactly as Krosan Reclamation
// `jud/green.ts` uses it). The body is the plain `createToken` Op (CR 111 /
// 701.7) with the token's own printed art pinned through `tokenPrintIdFor`
// (CR 114 — a missing image renders a placeholder silently).
//
// compiler-gap: Create a 3/3 green Elephant creature token. (#2693)
export const callOfTheHerd: CardDefinition = {
    id: CALL_OF_THE_HERD_ID,
    name: "Call of the Herd",
    rarity: "rare",
    oracleText: "Create a 3/3 green Elephant creature token.\nFlashback {3}{G}",
    manaCost: { X: 2, G: 1 },
    types: ["Sorcery"],
    flashback: { X: 3, G: 1 },
    effects: [
        {
            op: "createToken",
            token: {
                name: "Elephant",
                types: ["Creature"],
                subtypes: ["Elephant"],
                power: 3,
                toughness: 3,
                colors: ["G"],
                imagePrintId: tokenPrintIdFor(CALL_OF_THE_HERD_ID, "Elephant"),
            },
            controller: "controller",
            count: 1,
        },
    ],
};

// Terravore — {1}{G}{G} Creature — Lhurgoyf with trample (CR 702.19a) whose
// power AND toughness are each the number of land cards in ALL graveyards
// (CR 604.3 characteristic-defining ability, applied in layer 7a per
// CR 613.4b). Same `pt-cda` shape as its ICE ancestor Lhurgoyf
// (`ice/green.ts`), counting `Land`-typed cards instead of `Creature`-typed
// ones and with power === toughness (no +1 rider). The printed `*/*` is a 0/0
// base so the CDA yields exactly `{ n, n }`; `.types` survives
// `projectPublicState` (slimCard strips only `card`), so the count is
// identical on the wire — the mandatory wire-format test re-asserts it after
// projection.
//
// compiler-gap: Terravore's power and toughness are each equal to the number of land cards in all graveyards. (#2693)
export const terravore: CardDefinition = {
    id: "c39c412b-2f21-483a-b744-5d55bc007c0d",
    name: "Terravore",
    rarity: "rare",
    oracleText:
        "Trample\nTerravore's power and toughness are each equal to the number of land cards in all graveyards.",
    manaCost: { X: 1, G: 2 },
    types: ["Creature"],
    subtypes: ["Lhurgoyf"],
    power: 0,
    toughness: 0,
    staticAbilities: ["trample"],
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (_source, state) => {
                let lands = 0;
                for (const player of state.players) {
                    for (const card of player.graveyard) {
                        if (card.types.includes("Land")) lands++;
                    }
                }
                return { power: lands, toughness: lands };
            },
        },
    ],
};
