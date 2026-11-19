// Predefined tokens: "Create <count> [tapped] <Name> token[s]" (CR 111.10,
// issue #9948).
//
// A predefined token's characteristics are its DEFINITION's, never the line's
// (CR 111.10), so the rule reads only the name, the count and "tapped", and
// the lowering hands back the engine's own spec from the one name→spec table
// (`PREDEFINED_TOKEN_SPECS`, `convex/cards/sharedTokens.ts`).
//
//  1. GOLDEN fixtures — a real corpus card compiled whole, one per accepted
//     form: each name the table defines (Treasure, Food, Gold, Clue, Blood,
//     Map, Junk, Lander, Mutagen; Powerstone through the tapped form; Shard
//     on its sentence, no corpus card printing it compiling whole yet), a printed count, a tapped
//     token, a tapped count. The announced-X form (Treasure Vault) is a
//     `GOLDEN_FIXTURES` row, checked by `goldenFixtures.test.ts`: its count is
//     a form the canned smoke scenario cannot size.
//  2. GOLD — the lowered token IS the engine's shared spec, for every name in
//     the table, and equals what a hand-written producer writes (Magda's
//     Treasure).
//  3. REFUSALS — a name the engine defines no spec for (CR 111.10w Vibranium), a
//     count that disagrees with "token[s]", a count the quantity reader does
//     not bind ("that many"), and an X on a site that announces none.
//  4. FULL PATH — compiled Oracle text → the GRE resolves it →
//     `projectPublicState`: the tokens are on the battlefield, tapped, with
//     their mana ability.

import { describe, expect, it } from "vitest";
import { getDefinition, registerTokenDefinition } from "../../cards";
import {
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { BLOOD_TOKEN_SPEC } from "../../cards/abilities/tokens/bloodToken";
import { CLUE_TOKEN_SPEC } from "../../cards/abilities/tokens/clueToken";
import { MAP_TOKEN_SPEC } from "../../cards/abilities/tokens/mapToken";
import {
    EFFECT_TREASURE_TOKEN,
    FOOD_TOKEN,
    GOLD_TOKEN,
    JUNK_TOKEN,
    LANDER_TOKEN,
    MUTAGEN_TOKEN,
    POWERSTONE_TOKEN,
    PREDEFINED_TOKEN_SPECS,
    SHARD_TOKEN,
} from "../../cards/sharedTokens";
import type { EffectOp } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { resolveTopOfStack } from "../../gre/state";
import { compileCard } from "../compile";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

/** Compile a card and return its definition, failing the test if refused. */
function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function sorcery(oracleText: string, manaCost = "{2}") {
    return oracleCard({
        name: "Test Predefined Sorcery",
        manaCost,
        oracleText,
        typeLine: "Sorcery",
        power: undefined,
        toughness: undefined,
    });
}

describe("predefined tokens — golden fixtures (CR 111.10)", () => {
    it("Treasure (CR 111.10a) — Gleaming Barrier's death trigger", () => {
        const oracleText =
            'Defender\nWhen this creature dies, create a Treasure token. (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")';
        expect(
            compiled({
                oracleId: "1eb9e401-8975-447b-839d-f7cd23897465",
                name: "Gleaming Barrier",
                manaCost: "{2}",
                typeLine: "Artifact Creature — Wall",
                oracleText,
                power: "0",
                toughness: "4",
                layout: "normal",
            })
        ).toEqual({
            name: "Gleaming Barrier",
            types: ["Artifact", "Creature"],
            subtypes: ["Wall"],
            manaCost: { X: 2 },
            power: 0,
            toughness: 4,
            oracleText,
            staticAbilities: ["defender"],
            compiledTriggeredAbilities: [
                {
                    id: "gleaming-barrier-trigger",
                    oracleText:
                        "When this creature dies, create a Treasure token.",
                    head: { kind: "died", scope: "self" },
                    effects: [
                        {
                            op: "createToken",
                            token: EFFECT_TREASURE_TOKEN,
                            controller: "controller",
                        },
                    ],
                },
            ],
        });
    });

    it("Food (CR 111.10b) — Brandywine Farmer's enters-or-leaves trigger", () => {
        const oracleText =
            'When this creature enters or leaves the battlefield, create a Food token. (It\'s an artifact with "{2}, {T}, Sacrifice this token: You gain 3 life.")';
        expect(
            compiled({
                oracleId: "0fea3406-e5c7-4d5c-9890-6f1bc04a7cb8",
                name: "Brandywine Farmer",
                manaCost: "{2}{G}",
                typeLine: "Creature — Halfling Peasant",
                oracleText,
                power: "1",
                toughness: "1",
                layout: "normal",
            })
        ).toEqual({
            name: "Brandywine Farmer",
            types: ["Creature"],
            subtypes: ["Halfling", "Peasant"],
            manaCost: { X: 2, G: 1 },
            power: 1,
            toughness: 1,
            oracleText,
            compiledTriggeredAbilities: [
                {
                    id: "brandywine-farmer-trigger",
                    oracleText:
                        "When this creature enters or leaves the battlefield, create a Food token.",
                    head: { kind: "enters-or-leaves" },
                    effects: [
                        {
                            op: "createToken",
                            token: FOOD_TOKEN,
                            controller: "controller",
                        },
                    ],
                },
            ],
        });
    });

    it("Clue (CR 111.10f) — Callous Inspector, after a damage sentence", () => {
        const oracleText =
            "Menace (This creature can't be blocked except by two or more creatures.)\nWhen this creature dies, it deals 1 damage to you. Create a Clue token. (It's an artifact with \"{2}, Sacrifice this token: Draw a card.\")";
        expect(
            compiled({
                oracleId: "5d950fd4-8956-4b1a-ab0f-ab31bcffce4e",
                name: "Callous Inspector",
                manaCost: "{B}",
                typeLine: "Creature — Human Soldier",
                oracleText,
                power: "1",
                toughness: "1",
                layout: "normal",
            })
        ).toEqual({
            name: "Callous Inspector",
            types: ["Creature"],
            subtypes: ["Human", "Soldier"],
            manaCost: { B: 1 },
            power: 1,
            toughness: 1,
            oracleText,
            staticAbilities: ["menace"],
            compiledTriggeredAbilities: [
                {
                    id: "callous-inspector-trigger",
                    oracleText:
                        "When this creature dies, it deals 1 damage to you. Create a Clue token.",
                    head: { kind: "died", scope: "self" },
                    effects: [
                        {
                            op: "dealDamage",
                            amount: 1,
                            to: { player: "controller" },
                        },
                        {
                            op: "createToken",
                            token: CLUE_TOKEN_SPEC,
                            controller: "controller",
                        },
                    ],
                },
            ],
        });
    });

    it("Blood (CR 111.10g) — Voldaren Epicure", () => {
        const oracleText =
            'When this creature enters, it deals 1 damage to each opponent. Create a Blood token. (It\'s an artifact with "{1}, {T}, Discard a card, Sacrifice this token: Draw a card.")';
        expect(
            compiled({
                oracleId: "cef82674-1f61-407b-801b-a76a3803e598",
                name: "Voldaren Epicure",
                manaCost: "{R}",
                typeLine: "Creature — Vampire",
                oracleText,
                power: "1",
                toughness: "1",
                layout: "normal",
            })
        ).toEqual({
            name: "Voldaren Epicure",
            types: ["Creature"],
            subtypes: ["Vampire"],
            manaCost: { R: 1 },
            power: 1,
            toughness: 1,
            oracleText,
            compiledTriggeredAbilities: [
                {
                    id: "voldaren-epicure-trigger",
                    oracleText:
                        "When this creature enters, it deals 1 damage to each opponent. Create a Blood token.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "dealDamage",
                            amount: 1,
                            to: { player: "opponent" },
                        },
                        {
                            op: "createToken",
                            token: BLOOD_TOKEN_SPEC,
                            controller: "controller",
                        },
                    ],
                },
            ],
        });
    });

    it("Map (CR 111.10s) — Sentinel of the Nameless City", () => {
        const oracleText =
            'Vigilance\nWhenever this creature enters or attacks, create a Map token. (It\'s an artifact with "{1}, {T}, Sacrifice this token: Target creature you control explores. Activate only as a sorcery.")';
        expect(
            compiled({
                oracleId: "a5bbfe32-2fb9-48a0-bc8a-e9899aac1fda",
                name: "Sentinel of the Nameless City",
                manaCost: "{2}{G}",
                typeLine: "Creature — Merfolk Warrior Scout",
                oracleText,
                power: "3",
                toughness: "4",
                layout: "normal",
            })
        ).toEqual({
            name: "Sentinel of the Nameless City",
            types: ["Creature"],
            subtypes: ["Merfolk", "Warrior", "Scout"],
            manaCost: { X: 2, G: 1 },
            power: 3,
            toughness: 4,
            oracleText,
            staticAbilities: ["vigilance"],
            compiledTriggeredAbilities: [
                {
                    id: "sentinel-of-the-nameless-city-trigger",
                    oracleText:
                        "Whenever this creature enters or attacks, create a Map token.",
                    head: { kind: "enters-or-attacks" },
                    effects: [
                        {
                            op: "createToken",
                            token: MAP_TOKEN_SPEC,
                            controller: "controller",
                        },
                    ],
                },
            ],
        });
    });

    it("Mutagen (CR 111.10v) — Ooze Spill, in the spell slot", () => {
        const oracleText =
            'Counter target spell. Create a Mutagen token. (It\'s an artifact with "{1}, {T}, Sacrifice this token: Put a +1/+1 counter on target creature. Activate only as a sorcery.")';
        expect(
            compiled({
                oracleId: "c1c5f9da-1396-4406-b803-b64f66b8e49d",
                name: "Ooze Spill",
                manaCost: "{1}{U}{U}",
                typeLine: "Instant",
                oracleText,
                layout: "normal",
            })
        ).toEqual({
            name: "Ooze Spill",
            types: ["Instant"],
            manaCost: { X: 1, U: 2 },
            oracleText,
            effects: [
                { op: "counter", target: { target: 0 } },
                {
                    op: "createToken",
                    token: MUTAGEN_TOKEN,
                    controller: "controller",
                },
            ],
            targetRequirement: { type: "spell", count: 1 },
        });
    });

    it("Gold (CR 111.10c) — Gild, after an exile sentence", () => {
        const oracleText =
            'Exile target creature. Create a Gold token. (It\'s an artifact with "Sacrifice this token: Add one mana of any color.")';
        expect(
            compiled({
                oracleId: "a5530fac-0bae-451d-921d-0dd4865ec91d",
                name: "Gild",
                manaCost: "{3}{B}",
                typeLine: "Sorcery",
                oracleText,
                layout: "normal",
            })
        ).toEqual({
            name: "Gild",
            types: ["Sorcery"],
            manaCost: { X: 3, B: 1 },
            oracleText,
            effects: [
                { op: "exile", target: { target: 0 } },
                {
                    op: "createToken",
                    token: GOLD_TOKEN,
                    controller: "controller",
                },
            ],
            targetRequirement: { type: "Creature", count: 1 },
        });
    });

    it("Junk (CR 111.10t) — Break Down, in the instant slot", () => {
        const oracleText =
            'Destroy target artifact or enchantment. Create a Junk token. (It\'s an artifact with "{T}, Sacrifice this token: Exile the top card of your library. You may play that card this turn. Activate only as a sorcery.")';
        expect(
            compiled({
                oracleId: "73094bde-5466-41a4-88f9-a98e67f5ed2e",
                name: "Break Down",
                manaCost: "{2}{G}",
                typeLine: "Instant",
                oracleText,
                layout: "normal",
            })
        ).toEqual({
            name: "Break Down",
            types: ["Instant"],
            manaCost: { X: 2, G: 1 },
            oracleText,
            effects: [
                { op: "destroy", target: { target: 0 } },
                {
                    op: "createToken",
                    token: JUNK_TOKEN,
                    controller: "controller",
                },
            ],
            targetRequirement: {
                type: ["Artifact", "Enchantment"],
                count: 1,
            },
        });
    });

    it("Junk, a printed count in an activated ability — Junktown's three Junk tokens", () => {
        const oracleText =
            '{T}: Add {C}.\n{4}{R}, {T}, Sacrifice this land: Create three Junk tokens. (They\'re artifacts with "{T}, Sacrifice this token: Exile the top card of your library. You may play that card this turn. Activate only as a sorcery.")';
        expect(
            compiled({
                oracleId: "c470a802-931f-4b63-92fd-ef9cf2e796dd",
                name: "Junktown",
                manaCost: "",
                typeLine: "Land",
                oracleText,
                layout: "normal",
            })
        ).toEqual({
            name: "Junktown",
            types: ["Land"],
            oracleText,
            activatedAbilities: [
                {
                    id: "junktown-mana",
                    oracleText: "{T}: Add {C}.",
                    cost: { tap: true },
                    useStack: false,
                    manaProduced: { C: 1 },
                },
                {
                    id: "junktown-ability-2",
                    oracleText:
                        "{4}{R}, {T}, Sacrifice this land: Create three Junk tokens.",
                    cost: { mana: { X: 4, R: 1 }, tap: true, sacrifice: true },
                    useStack: true,
                    effects: [
                        {
                            op: "createToken",
                            token: JUNK_TOKEN,
                            controller: "controller",
                            count: 3,
                        },
                    ],
                },
            ],
        });
    });

    it("Lander (CR 111.10u) — Galactic Wayfarer's enters trigger", () => {
        const oracleText =
            'When this creature enters, create a Lander token. (It\'s an artifact with "{2}, {T}, Sacrifice this token: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.")';
        expect(
            compiled({
                oracleId: "86746a84-3e8a-44b4-8494-60cbee9816b5",
                name: "Galactic Wayfarer",
                manaCost: "{2}{G}",
                typeLine: "Creature — Human Scout",
                oracleText,
                power: "3",
                toughness: "3",
                layout: "normal",
            })
        ).toEqual({
            name: "Galactic Wayfarer",
            types: ["Creature"],
            subtypes: ["Human", "Scout"],
            manaCost: { X: 2, G: 1 },
            power: 3,
            toughness: 3,
            oracleText,
            compiledTriggeredAbilities: [
                {
                    id: "galactic-wayfarer-trigger",
                    oracleText:
                        "When this creature enters, create a Lander token.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "createToken",
                            token: LANDER_TOKEN,
                            controller: "controller",
                        },
                    ],
                },
            ],
        });
    });

    it("Shard (CR 111.10e) — a printed count of the one predefined enchantment token", () => {
        // No corpus card printing a Shard token compiles whole yet (Niko,
        // Light of Hope and Niko Aris each carry another gap), so the form is
        // pinned on the sentence: the name lowers to the shared spec.
        expect(compiled(sorcery("Create two Shard tokens.")).effects).toEqual([
            {
                op: "createToken",
                token: SHARD_TOKEN,
                controller: "controller",
                count: 2,
            },
        ]);
    });

    it('a tapped token (CR 111.10h + CR 111.10) — Koilos Roc\'s "tapped Powerstone"', () => {
        const oracleText =
            "Flash\nFlying\nWhen this creature enters, create a tapped Powerstone token. (It's an artifact with \"{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.\")";
        expect(
            compiled({
                oracleId: "0956c0f5-ff1d-43d5-88de-4c2d603cf798",
                name: "Koilos Roc",
                manaCost: "{4}{U}",
                typeLine: "Creature — Bird",
                oracleText,
                power: "3",
                toughness: "3",
                layout: "normal",
            })
        ).toEqual({
            name: "Koilos Roc",
            types: ["Creature"],
            subtypes: ["Bird"],
            manaCost: { X: 4, U: 1 },
            power: 3,
            toughness: 3,
            oracleText,
            staticAbilities: ["flash", "flying"],
            compiledTriggeredAbilities: [
                {
                    id: "koilos-roc-trigger",
                    oracleText:
                        "When this creature enters, create a tapped Powerstone token.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "createToken",
                            token: { ...POWERSTONE_TOKEN, entersTapped: true },
                            controller: "controller",
                        },
                    ],
                },
            ],
        });
    });

    it("a printed count — Rapacious Dragon's two Treasures", () => {
        const oracleText =
            'Flying\nWhen this creature enters, create two Treasure tokens. (They\'re artifacts with "{T}, Sacrifice this token: Add one mana of any color.")';
        expect(
            compiled({
                oracleId: "0944ec2e-1dd9-459f-8f1d-667242cf52fe",
                name: "Rapacious Dragon",
                manaCost: "{4}{R}",
                typeLine: "Creature — Dragon",
                oracleText,
                power: "3",
                toughness: "3",
                layout: "normal",
            })
        ).toEqual({
            name: "Rapacious Dragon",
            types: ["Creature"],
            subtypes: ["Dragon"],
            manaCost: { X: 4, R: 1 },
            power: 3,
            toughness: 3,
            oracleText,
            staticAbilities: ["flying"],
            compiledTriggeredAbilities: [
                {
                    id: "rapacious-dragon-trigger",
                    oracleText:
                        "When this creature enters, create two Treasure tokens.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "createToken",
                            token: EFFECT_TREASURE_TOKEN,
                            controller: "controller",
                            count: 2,
                        },
                    ],
                },
            ],
        });
    });

    it("a tapped count — Fallaji Excavation's three tapped Powerstones", () => {
        const oracleText =
            'Create three tapped Powerstone tokens. You gain 3 life. (The tokens are artifacts with "{T}: Add {C}. This mana can\'t be spent to cast a nonartifact spell.")';
        expect(
            compiled({
                oracleId: "b13c91be-079a-46f1-8a99-b7dba99bb9c0",
                name: "Fallaji Excavation",
                manaCost: "{3}{G}{G}",
                typeLine: "Sorcery",
                oracleText,
                layout: "normal",
            })
        ).toEqual({
            name: "Fallaji Excavation",
            types: ["Sorcery"],
            manaCost: { X: 3, G: 2 },
            oracleText,
            effects: [
                {
                    op: "createToken",
                    token: { ...POWERSTONE_TOKEN, entersTapped: true },
                    controller: "controller",
                    count: 3,
                },
                { op: "gainLife", player: "controller", amount: 3 },
            ],
        });
    });
});

describe("predefined tokens — gold: the lowered token is the engine's spec", () => {
    it("every name in the table lowers to exactly its shared spec", () => {
        for (const [name, spec] of Object.entries(PREDEFINED_TOKEN_SPECS)) {
            const definition = compiled(sorcery(`Create a ${name} token.`));
            expect(definition.effects).toEqual([
                { op: "createToken", token: spec, controller: "controller" },
            ]);
        }
    });

    it("a compiled Treasure equals the hand-written producer's (Magda, Brazen Outlaw)", () => {
        const magda = getDefinition("079e6263-e54c-4899-a336-5315909b9322");
        expect(magda.name).toBe("Magda, Brazen Outlaw");
        const handWritten = magda.triggeredAbilities?.[0]?.effects as
            | EffectOp[]
            | undefined;
        expect(handWritten).toBeDefined();
        expect(compiled(sorcery("Create a Treasure token.")).effects).toEqual(
            handWritten
        );
    });

    it("the lowered spec is a copy: compiling never aliases the shared constant", () => {
        const [op] = compiled(sorcery("Create a tapped Treasure token."))
            .effects as Extract<EffectOp, { op: "createToken" }>[];
        expect(op!.token).not.toBe(EFFECT_TREASURE_TOKEN);
        expect(EFFECT_TREASURE_TOKEN.entersTapped).toBeUndefined();
    });
});

describe("predefined tokens — refusals (fail-closed)", () => {
    it.each([
        // CR 111.10w — Vibranium is predefined, but the engine has no spec
        // for it: never read as a creature subtype or a guess.
        ["an undefined predefined name", "Create a Vibranium token."],
        ["a role token (CR 111.10j)", "Create a Cursed Role token."],
        ["a singular count with a plural noun", "Create a Treasure tokens."],
        ["a plural count with a singular noun", "Create two Treasure token."],
        ["X with a singular noun", "Create X Treasure token."],
        [
            '"that many", which the quantity reader does not bind',
            "Create that many Blood tokens.",
        ],
        ['"half X"', "Create half X Food tokens, rounded up."],
        ["a lowercase name", "Create a treasure token."],
    ])("%s: %s", (_label, text) => {
        expect(compileCard(sorcery(text)).state).toBe("unparsed");
    });

    it("an X count on a site that announces no X is refused (CR 107.3)", () => {
        expect(
            compileCard(
                oracleCard({
                    name: "Test X Treasure Creature",
                    oracleText:
                        "When this creature enters, create X Treasure tokens.",
                })
            ).state
        ).toBe("unparsed");
    });
});

describe("predefined tokens — full path (CR 111.10, CR 111.10h)", () => {
    const outcome = compileCard(
        sorcery("Create two tapped Powerstone tokens.", "{3}")
    );
    if (outcome.state !== "ready")
        throw new Error(`not ready: ${JSON.stringify(outcome)}`);
    const id = "test-predefined-powerstone-sorcery";
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { X: 3 },
        types: ["Sorcery"],
        effects: outcome.definition.effects,
    });
    const state = makeState({
        players: [makePlayer("p1"), makePlayer("p2")],
    });
    pushSpell(state, id, "p1", []);
    resolveTopOfStack(state);

    it("the GRE puts two tapped Powerstones with their mana ability onto the battlefield", () => {
        const tokens = state.players[0].battlefield.filter((c) => c.isToken);
        expect(tokens).toHaveLength(2);
        for (const token of tokens) {
            expect(token.types).toEqual(["Artifact"]);
            expect(token.subtypes).toEqual(["Powerstone"]);
            expect(token.isTapped).toBe(true);
            const definition = getDefinition((token.card as { id: string }).id);
            expect(definition.activatedAbilities?.map((a) => a.id)).toEqual([
                "powerstone-token-mana",
            ]);
        }
    });

    it("the projection the client reads keeps them tapped Powerstone artifacts", () => {
        const projected = projectPublicState(state, 1, "p1");
        const tokens = projected.players[0]!.battlefield.filter(
            (c) => c.isToken
        );
        expect(tokens).toHaveLength(2);
        for (const token of tokens) {
            expect(token.types).toEqual(["Artifact"]);
            expect(token.subtypes).toEqual(["Powerstone"]);
            expect(token.isTapped).toBe(true);
        }
    });
});
