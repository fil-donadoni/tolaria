// "Can't" locks — turn-scoped restrictions on a creature or a player.
//
// Three layers:
//  1. GOLDEN — a real corpus card compiled whole must produce exactly this
//     Compiled Definition (combat restriction, regeneration lock, the opponents'
//     cast lock, the targeted cast + activation lock).
//  2. REFUSALS — the neighbours stay unparsed: a sweep, a two-restriction
//     sentence, "can't attack" (no fixture-able corpus card without buyback), a
//     qualified or lowercase player.
//  3. Lowering — one announcement serves both halves of the targeted lock.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(`${card.name} ${outcome.state}`);
    return outcome.definition;
}

function spell(name: string, oracleText: string, manaCost = "{W}") {
    return oracleCard({
        name,
        manaCost,
        typeLine: "Instant",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

describe("golden: locks", () => {
    it("Silence — the opponents' cast lock (CR 101.2, CR 601.2)", () => {
        const card = oracleCard({
            oracleId: "8aed54cb-d1bb-45ad-adbe-38e55d84ff31",
            name: "Silence",
            manaCost: "{W}",
            typeLine: "Instant",
            oracleText: "Your opponents can't cast spells this turn.",
            power: undefined,
            toughness: undefined,
        });
        expect(sortKeys(compiled(card))).toEqual(
            sortKeys({
                name: "Silence",
                types: ["Instant"],
                manaCost: { W: 1 },
                oracleText: "Your opponents can't cast spells this turn.",
                effects: [{ op: "restrictCasting", player: "opponent" }],
            })
        );
    });

    it("Infiltrate — a creature that can't be blocked (CR 509.1b)", () => {
        const card = oracleCard({
            oracleId: "081764b4-ef96-44aa-836c-05353efd215c",
            name: "Infiltrate",
            manaCost: "{U}",
            typeLine: "Instant",
            oracleText: "Target creature can't be blocked this turn.",
            power: undefined,
            toughness: undefined,
        });
        expect(sortKeys(compiled(card))).toEqual(
            sortKeys({
                name: "Infiltrate",
                types: ["Instant"],
                manaCost: { U: 1 },
                oracleText: "Target creature can't be blocked this turn.",
                effects: [
                    {
                        op: "restrictCombat",
                        restriction: "cant-be-blocked",
                        target: { target: 0 },
                    },
                ],
                targetRequirement: { type: "Creature", count: 1 },
            })
        );
    });

    it("Renegade Tactics — a creature that can't block (CR 509.1a)", () => {
        const card = oracleCard({
            oracleId: "7fbcd256-c132-406f-a490-df9709835504",
            name: "Renegade Tactics",
            manaCost: "{R}",
            typeLine: "Sorcery",
            oracleText: "Target creature can't block this turn.\nDraw a card.",
            power: undefined,
            toughness: undefined,
        });
        expect(sortKeys(compiled(card))).toEqual(
            sortKeys({
                name: "Renegade Tactics",
                types: ["Sorcery"],
                manaCost: { R: 1 },
                oracleText:
                    "Target creature can't block this turn.\nDraw a card.",
                effects: [
                    {
                        op: "restrictCombat",
                        restriction: "cant-block",
                        target: { target: 0 },
                    },
                    { op: "draw", player: "controller", count: 1 },
                ],
                targetRequirement: { type: "Creature", count: 1 },
            })
        );
    });

    it("Hurr Jackal — the regeneration lock in an activated ability (CR 701.19c)", () => {
        const card = oracleCard({
            oracleId: "d17f5afa-a884-4b99-aa9e-89ddb3d43b22",
            name: "Hurr Jackal",
            manaCost: "{R}",
            typeLine: "Creature — Jackal",
            oracleText: "{T}: Target creature can't be regenerated this turn.",
            power: "1",
            toughness: "1",
        });
        expect(sortKeys(compiled(card))).toEqual(
            sortKeys({
                name: "Hurr Jackal",
                types: ["Creature"],
                subtypes: ["Jackal"],
                manaCost: { R: 1 },
                power: 1,
                toughness: 1,
                oracleText:
                    "{T}: Target creature can't be regenerated this turn.",
                activatedAbilities: [
                    {
                        id: "hurr-jackal-ability",
                        oracleText:
                            "{T}: Target creature can't be regenerated this turn.",
                        cost: { tap: true },
                        useStack: true,
                        effects: [
                            {
                                op: "preventRegeneration",
                                target: { target: 0 },
                            },
                        ],
                        targetRequirement: { type: "Creature", count: 1 },
                    },
                ],
            })
        );
    });

    it("Abeyance — one announced player, both locks (CR 601.2, CR 602.2)", () => {
        const card = oracleCard({
            oracleId: "6300de53-6e71-4f0e-87e1-b0acd25c59a8",
            name: "Abeyance",
            manaCost: "{1}{W}",
            typeLine: "Instant",
            oracleText:
                "Until end of turn, target player can't cast instant or sorcery spells, and that player can't activate abilities that aren't mana abilities.\nDraw a card.",
            power: undefined,
            toughness: undefined,
        });
        const def = compiled(card);
        expect(def.effects).toEqual([
            {
                op: "restrictCasting",
                player: { target: 0 },
                cardTypes: ["Instant", "Sorcery"],
            },
            { op: "restrictActivation", player: { target: 0 } },
            { op: "draw", player: "controller", count: 1 },
        ]);
        // One announcement serves both halves (lowering invariant).
        expect(def.targetRequirement).toEqual({ type: "player", count: 1 });
    });

    it("Xantid Swarm — the defending player's cast lock behind its own attack (CR 506.2, CR 508.5, CR 601.2)", () => {
        const card = oracleCard({
            oracleId: "13ba9ef8-2010-4d3f-8c62-85b7c5620031",
            name: "Xantid Swarm",
            manaCost: "{G}",
            typeLine: "Creature — Insect",
            oracleText:
                "Flying\nWhenever this creature attacks, defending player can't cast spells this turn.",
            power: "0",
            toughness: "1",
        });
        expect(sortKeys(compiled(card))).toEqual(
            sortKeys({
                name: "Xantid Swarm",
                types: ["Creature"],
                subtypes: ["Insect"],
                manaCost: { G: 1 },
                power: 0,
                toughness: 1,
                oracleText:
                    "Flying\nWhenever this creature attacks, defending player can't cast spells this turn.",
                staticAbilities: ["flying"],
                compiledTriggeredAbilities: [
                    {
                        id: "xantid-swarm-trigger",
                        oracleText:
                            "Whenever this creature attacks, defending player can't cast spells this turn.",
                        head: { kind: "attacks" },
                        effects: [
                            { op: "restrictCasting", player: "opponent" },
                        ],
                    },
                ],
            })
        );
    });

    it("Agate-Blade Assassin — the same defending-player reference behind another verb (CR 508.5)", () => {
        const card = oracleCard({
            oracleId: "381a3e8e-71dd-48e4-ab62-53478bde4a14",
            name: "Agate-Blade Assassin",
            manaCost: "{1}{B}",
            typeLine: "Creature — Lizard Assassin",
            oracleText:
                "Whenever this creature attacks, defending player loses 1 life and you gain 1 life.",
            power: "1",
            toughness: "3",
        });
        expect(sortKeys(compiled(card))).toEqual(
            sortKeys({
                name: "Agate-Blade Assassin",
                types: ["Creature"],
                subtypes: ["Lizard", "Assassin"],
                manaCost: { B: 1, X: 1 },
                power: 1,
                toughness: 3,
                oracleText:
                    "Whenever this creature attacks, defending player loses 1 life and you gain 1 life.",
                compiledTriggeredAbilities: [
                    {
                        id: "agate-blade-assassin-trigger",
                        oracleText:
                            "Whenever this creature attacks, defending player loses 1 life and you gain 1 life.",
                        head: { kind: "attacks" },
                        effects: [
                            { op: "loseLife", player: "opponent", amount: 1 },
                            { op: "gainLife", player: "controller", amount: 1 },
                        ],
                    },
                ],
            })
        );
    });
});

describe("golden: land-play lock (CR 305.1, CR 101.2, issue #2145)", () => {
    it("Turf Wound — one announced player, then the draw", () => {
        const card = oracleCard({
            oracleId: "9a31a3ee-2c8f-4f5e-8b6e-0a53a3b8f6d2",
            name: "Turf Wound",
            manaCost: "{2}{R}",
            typeLine: "Instant",
            oracleText:
                "Target player can't play lands this turn.\nDraw a card.",
            power: undefined,
            toughness: undefined,
        });
        const def = compiled(card);
        expect(def.effects).toEqual([
            { op: "restrictLandPlay", player: { target: 0 } },
            { op: "draw", player: "controller", count: 1 },
        ]);
        expect(def.targetRequirement).toEqual({ type: "player", count: 1 });
    });

    it("refuses a lowercase / qualified neighbour", () => {
        const outcome = compileCard(
            spell(
                "Neighbour",
                "Target opponent can't play lands this turn.",
                "{R}"
            )
        );
        expect(outcome.state).not.toBe("ready");
    });
});

describe("refusals: neighbours stay unparsed", () => {
    const refused: [string, string][] = [
        // A sweep also binds creatures that arrive later (CR 611.2c).
        ["a sweep", "Creatures can't block this turn."],
        [
            "a qualified sweep",
            "Creatures without flying can't block this turn.",
        ],
        // Two restrictions in one sentence — no fixture-able card.
        [
            "two restrictions",
            "Target creature can't attack or block this turn.",
        ],
        // No corpus card without buyback prints it standalone.
        ["can't attack", "Target creature can't attack this turn."],
        // The duration is the sentence's, not optional.
        ["no duration", "Target creature can't block."],
        // Only the opponents' whole-spell lock is read.
        [
            "a typed cast lock",
            "Your opponents can't cast creature spells this turn.",
        ],
        ["a regeneration sweep", "Creatures can't be regenerated this turn."],
    ];
    // "defending player" has a referent only behind the source's own attack
    // (CR 508.5): anywhere else the words name no one.
    const creature = (oracleText: string) =>
        oracleCard({
            name: "Refused Creature",
            manaCost: "{G}",
            typeLine: "Creature — Insect",
            oracleText,
            power: "0",
            toughness: "1",
        });
    for (const [label, text] of [
        [
            "a spell naming a defending player",
            "Defending player can't cast spells this turn.",
        ],
        [
            "another creature's attack",
            "Whenever a creature you control attacks, defending player can't cast spells this turn.",
        ],
        [
            "a block head",
            "Whenever this creature blocks, defending player can't cast spells this turn.",
        ],
    ] as const)
        it(`refuses ${label}`, () => {
            expect(compileCard(creature(text)).state).toBe("unparsed");
        });
    for (const [label, text] of refused)
        it(`refuses ${label}`, () => {
            expect(compileCard(spell("Refused", text, "{1}")).state).toBe(
                "unparsed"
            );
        });
});
