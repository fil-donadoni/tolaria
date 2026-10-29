// Turn-structure clauses (issue #4535): "Take an extra turn after this one"
// (CR 500.7), "After this phase, there is an additional combat phase"
// (CR 500.8), "You skip your next turn" (CR 614.10) and "you skip your draw
// step this turn" (CR 504.1) — four Verb Frames, one Op each (`extraTurn`,
// `extraCombat`, `skipNextTurn`, `skipDrawStepThisTurn`).
//
//  1. GOLDENS — a real corpus card per accepted form, compiled whole and
//     compared against the entire Compiled Definition. No `GOLDEN_FIXTURES`
//     row: none of the four Ops is a card-dependent smoke skip that a fixture
//     would clear.
//  2. REFUSALS — the neighbours the frames do not read (a count, a rider on
//     the turn, a main-phase anchor) pinned `unparsed`, so fail-closed is
//     asserted, not assumed.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

describe("turn-structure frames — golden fixtures (CR 500.7, CR 500.8, CR 614.10, CR 504.1)", () => {
    it("imperative extra turn — spell slot (Time Walk)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Time Walk",
                manaCost: "{1}{U}",
                typeLine: "Sorcery",
                oracleText: "Take an extra turn after this one.",
            })
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(outcome.state).toBe("ready");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Time Walk",
                types: ["Sorcery"],
                manaCost: { X: 1, U: 1 },
                oracleText: "Take an extra turn after this one.",
                effects: [{ op: "extraTurn", player: "controller" }],
            })
        );
    });

    it("announced player takes the turn — spell slot (Time Warp)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Time Warp",
                manaCost: "{3}{U}{U}",
                typeLine: "Sorcery",
                oracleText: "Target player takes an extra turn after this one.",
            })
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(outcome.state).toBe("ready");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Time Warp",
                types: ["Sorcery"],
                manaCost: { X: 3, U: 2 },
                oracleText: "Target player takes an extra turn after this one.",
                effects: [{ op: "extraTurn", player: { target: 0 } }],
                targetRequirement: { type: "player", count: 1 },
            })
        );
    });

    it('"you take" behind a trigger head (Wormfang Manta)', () => {
        const outcome = compileCard(
            oracleCard({
                name: "Wormfang Manta",
                manaCost: "{5}{U}{U}",
                typeLine: "Creature — Nightmare Fish Beast",
                oracleText:
                    "Flying\nWhen this creature enters, you skip your next turn.\nWhen this creature leaves the battlefield, you take an extra turn after this one.",
                power: "6",
                toughness: "1",
            })
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(outcome.state).toBe("ready");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Wormfang Manta",
                types: ["Creature"],
                subtypes: ["Nightmare", "Fish", "Beast"],
                manaCost: { X: 5, U: 2 },
                power: 6,
                toughness: 1,
                oracleText:
                    "Flying\nWhen this creature enters, you skip your next turn.\nWhen this creature leaves the battlefield, you take an extra turn after this one.",
                staticAbilities: ["flying"],
                compiledTriggeredAbilities: [
                    {
                        id: "wormfang-manta-trigger",
                        oracleText:
                            "When this creature enters, you skip your next turn.",
                        head: { kind: "entered", scope: "self" },
                        effects: [{ op: "skipNextTurn", player: "controller" }],
                    },
                    {
                        id: "wormfang-manta-trigger-2",
                        oracleText:
                            "When this creature leaves the battlefield, you take an extra turn after this one.",
                        head: { kind: "left", scope: "self" },
                        effects: [{ op: "extraTurn", player: "controller" }],
                    },
                ],
            })
        );
    });

    it("skip your next turn — spell slot (Meditate)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Meditate",
                manaCost: "{2}{U}",
                typeLine: "Instant",
                oracleText: "Draw four cards. You skip your next turn.",
            })
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(outcome.state).toBe("ready");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Meditate",
                types: ["Instant"],
                manaCost: { X: 2, U: 1 },
                oracleText: "Draw four cards. You skip your next turn.",
                effects: [
                    { op: "draw", player: "controller", count: 4 },
                    { op: "skipNextTurn", player: "controller" },
                ],
            })
        );
    });

    it("skip your next turn — activated slot (Chronatog)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Chronatog",
                manaCost: "{1}{U}",
                typeLine: "Creature — Atog",
                oracleText:
                    "{0}: This creature gets +3/+3 until end of turn. You skip your next turn. Activate only once each turn.",
                power: "1",
                toughness: "2",
            })
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(outcome.state).toBe("ready");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Chronatog",
                types: ["Creature"],
                subtypes: ["Atog"],
                manaCost: { X: 1, U: 1 },
                power: 1,
                toughness: 2,
                oracleText:
                    "{0}: This creature gets +3/+3 until end of turn. You skip your next turn. Activate only once each turn.",
                activatedAbilities: [
                    {
                        id: "chronatog-ability",
                        oracleText:
                            "{0}: This creature gets +3/+3 until end of turn. You skip your next turn. Activate only once each turn.",
                        cost: { mana: {} },
                        useStack: true,
                        effects: [
                            {
                                op: "pump",
                                target: { ref: "$source" },
                                power: 3,
                                toughness: 3,
                                duration: { phase: "end-of-turn" },
                            },
                            { op: "skipNextTurn", player: "controller" },
                        ],
                        oncePerTurn: true,
                    },
                ],
            })
        );
    });

    it("skip this turn's draw step behind a reflexive gate (Elfhame Sanctuary)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Elfhame Sanctuary",
                manaCost: "{1}{G}",
                typeLine: "Enchantment",
                oracleText:
                    "At the beginning of your upkeep, you may search your library for a basic land card, reveal that card, put it into your hand, then shuffle. If you do, you skip your draw step this turn.",
            })
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(outcome.state).toBe("quarantine");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Elfhame Sanctuary",
                types: ["Enchantment"],
                manaCost: { X: 1, G: 1 },
                oracleText:
                    "At the beginning of your upkeep, you may search your library for a basic land card, reveal that card, put it into your hand, then shuffle. If you do, you skip your draw step this turn.",
                compiledTriggeredAbilities: [
                    {
                        id: "elfhame-sanctuary-trigger",
                        oracleText:
                            "At the beginning of your upkeep, you may search your library for a basic land card, reveal that card, put it into your hand, then shuffle. If you do, you skip your draw step this turn.",
                        head: { kind: "phase", phase: "UPKEEP", scope: "your" },
                        effects: [
                            {
                                op: "mayPay",
                                player: "controller",
                                prompt: "Search your library for a basic land card, reveal that card, put it into your hand, then shuffle?",
                                bind: "$may2",
                            },
                            {
                                op: "if",
                                predicate: { binding: "$may2" },
                                then: [
                                    {
                                        op: "choice",
                                        kind: "search-library",
                                        player: "controller",
                                        zone: "library",
                                        filter: {
                                            type: "Land",
                                            supertype: "Basic",
                                        },
                                        count: { min: 0, max: 1 },
                                        prompt: "Search your library for a basic land card.",
                                        bind: "$found1",
                                    },
                                    {
                                        op: "reveal",
                                        player: "controller",
                                        cards: { ref: "$found1" },
                                    },
                                    {
                                        op: "moveZone",
                                        cards: { ref: "$found1" },
                                        player: "controller",
                                        from: "library",
                                        to: "hand",
                                        bind: "$did3",
                                    },
                                    {
                                        op: "libraryLook",
                                        action: "shuffle",
                                        player: "controller",
                                    },
                                    {
                                        op: "if",
                                        predicate: {
                                            boundMatchesFilter: {
                                                ref: "$did3",
                                            },
                                            filter: {},
                                        },
                                        then: [
                                            {
                                                op: "skipDrawStepThisTurn",
                                                player: "controller",
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("after this phase, an additional combat phase — triggered slot (Bloodthirster, trigger line only)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Bloodthirster",
                manaCost: "{5}{R}",
                typeLine: "Creature — Demon",
                oracleText:
                    "Whenever this creature deals combat damage to a player, untap it. After this phase, there is an additional combat phase.",
                power: "6",
                toughness: "6",
            })
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(outcome.state).toBe("ready");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Bloodthirster",
                types: ["Creature"],
                subtypes: ["Demon"],
                manaCost: { X: 5, R: 1 },
                power: 6,
                toughness: 6,
                oracleText:
                    "Whenever this creature deals combat damage to a player, untap it. After this phase, there is an additional combat phase.",
                compiledTriggeredAbilities: [
                    {
                        id: "bloodthirster-trigger",
                        oracleText:
                            "Whenever this creature deals combat damage to a player, untap it. After this phase, there is an additional combat phase.",
                        head: { kind: "combat-damage-to-player" },
                        effects: [
                            {
                                op: "tapUntap",
                                action: "untap",
                                target: { ref: "$source" },
                            },
                            { op: "extraCombat" },
                        ],
                    },
                ],
            })
        );
    });
});

describe("turn-structure frames — refused neighbours (fail-closed)", () => {
    const state = (name: string, typeLine: string, oracleText: string) =>
        compileCard(
            oracleCard({ name, manaCost: "{3}{U}{U}", typeLine, oracleText })
        ).state;

    it("a count of extra turns (Time Stretch)", () => {
        expect(
            state(
                "Time Stretch",
                "Sorcery",
                "Target player takes two extra turns after this one."
            )
        ).toBe("unparsed");
    });

    it("a rider on the extra turn (Last Chance)", () => {
        expect(
            state(
                "Last Chance",
                "Sorcery",
                "Take an extra turn after this one. At the beginning of that turn's end step, you lose the game."
            )
        ).toBe("unparsed");
    });

    it("a main-phase anchor and a count of combat phases (Full Throttle)", () => {
        expect(
            state(
                "Full Throttle",
                "Sorcery",
                "After this main phase, there are two additional combat phases."
            )
        ).toBe("unparsed");
    });

    it("a main-phase anchor on one combat phase (Seize the Day)", () => {
        expect(
            state(
                "Seize the Day",
                "Sorcery",
                "After this main phase, there is an additional combat phase followed by an additional main phase."
            )
        ).toBe("unparsed");
    });

    it("the bare imperative skip (Magosi, the Waterveil)", () => {
        expect(
            state("Magosi, the Waterveil", "Sorcery", "Skip your next turn.")
        ).toBe("unparsed");
    });

    it("an extra turn for a player no frame names (Eon Frolicker's opponent)", () => {
        expect(
            state(
                "Test Spell",
                "Sorcery",
                "Target opponent takes an extra turn after this one."
            )
        ).toBe("unparsed");
    });
});
