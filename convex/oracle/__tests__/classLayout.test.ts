// The `class` layout (CR 716.2, issue #8046): a level bar is a SECTION, not a
// line, and a compiled Class reports the `setLevel` its bars run.
//
//  1. GOLDEN — Stormchaser's Talent's real Oracle row, the whole definition.
//  2. ROUND TRIP — the same row against the hand-written card (verdict `equal`,
//     never `incomparable`, which would pass a mismatch).
//  3. REFUSALS — a card is refused whole, never truncated.
//  4. THE ENGINE — a compiled Class driven through the real stack and the real
//     layer system: what `compiledTriggeredAbilities` on a bar becomes, and each
//     section static that is not an `applies` predicate, below and at its level.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName, getDefinition } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { getEffectivePower } from "../../gre/layers";
import { getExtraLandDrops, getLegalActions } from "../../gre/rules";
import { getCostModifiers, resolveTopOfStack } from "../../gre/state";
import { projectPublicState } from "../../gameProjections";
import { collectTriggers } from "../../gre/triggers";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { roundTripCard } from "../gold";
import { oracleCard } from "./oracle.fixture";

const REMINDER = "(Gain the next level as a sorcery to add its ability.)";

function classCard(name: string, manaCost: string, lines: readonly string[]) {
    return oracleCard({
        name,
        manaCost,
        typeLine: "Enchantment — Class",
        oracleText: lines.join("\n"),
        power: undefined,
        toughness: undefined,
        layout: "class",
    });
}

const OTTER = {
    name: "Otter",
    types: ["Creature"],
    subtypes: ["Otter"],
    power: 1,
    toughness: 1,
    colors: ["U", "R"],
    staticAbilities: ["prowess"],
};
const ETB_LINE =
    "When this Class enters, create a 1/1 blue and red Otter creature token with prowess.";
const LEVEL_2_LINE =
    "When this Class becomes level 2, return target instant or sorcery card from your graveyard to your hand.";
const LEVEL_3_LINE =
    "Whenever you cast an instant or sorcery spell, create a 1/1 blue and red Otter creature token with prowess.";
const STORMCHASER_LINES = [
    REMINDER,
    ETB_LINE,
    "{3}{U}: Level 2",
    LEVEL_2_LINE,
    "{5}{U}: Level 3",
    LEVEL_3_LINE,
];
const ANTHEM_LINE = "Creatures you control get +1/+1.";
const stormchaser = () =>
    classCard("Stormchaser's Talent", "{U}", STORMCHASER_LINES);

function refusals(lines: readonly string[]): string[] {
    const outcome = compileCard(classCard("Test Class", "{U}", lines));
    if (outcome.state !== "unparsed")
        throw new Error(`expected a refusal, got ${outcome.state}`);
    return outcome.gaps.map((g) => g.reason);
}

describe("Class layout — golden (CR 716.2a / 716.3)", () => {
    it("Stormchaser's Talent: the top section is the card, each bar owns its lines", () => {
        const outcome = compileCard(stormchaser());
        if (outcome.state !== "ready")
            throw new Error(`not ready: ${JSON.stringify(outcome)}`);
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Stormchaser's Talent",
                types: ["Enchantment"],
                subtypes: ["Class"],
                manaCost: { U: 1 },
                oracleText: STORMCHASER_LINES.join("\n"),
                compiledTriggeredAbilities: [
                    {
                        id: "stormchaser-s-talent-trigger",
                        oracleText: ETB_LINE,
                        head: { kind: "entered", scope: "self" },
                        effects: [
                            {
                                op: "createToken",
                                token: OTTER,
                                controller: "controller",
                            },
                        ],
                    },
                ],
                classLevelBars: [
                    {
                        level: 2,
                        cost: { X: 3, U: 1 },
                        costLabel: "{3}{U}",
                        compiledTriggeredAbilities: [
                            {
                                id: "stormchaser-s-talent-trigger-level-2",
                                oracleText: LEVEL_2_LINE,
                                head: { kind: "class-level-gained", level: 2 },
                                targetRequirement: {
                                    type: ["Instant", "Sorcery"],
                                    count: 1,
                                    zone: "graveyard",
                                    controller: "you",
                                },
                                effects: [
                                    {
                                        op: "moveZone",
                                        target: { target: 0 },
                                        to: "hand",
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        level: 3,
                        cost: { X: 5, U: 1 },
                        costLabel: "{5}{U}",
                        compiledTriggeredAbilities: [
                            {
                                id: "stormchaser-s-talent-trigger-level-3",
                                oracleText: LEVEL_3_LINE,
                                head: {
                                    kind: "spell-cast",
                                    scope: "you",
                                    filter: { types: ["Instant", "Sorcery"] },
                                },
                                effects: [
                                    {
                                        op: "createToken",
                                        token: OTTER,
                                        controller: "controller",
                                    },
                                ],
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("CR 716.2a — opsUsed counts the setLevel no authored script carries", () => {
        const outcome = compileCard(stormchaser());
        if (outcome.state === "unparsed") throw new Error("unparsed");
        expect(outcome.opsUsed).toEqual([
            "createToken",
            "moveZone",
            "setLevel",
        ]);
        expect(outcome.slots).toEqual(["class-level-bar", "triggered"]);
    });

    it("round-trips the hand-written card, field for field (Guard C)", () => {
        const handWritten = getDefinition(
            getCardByName("Stormchaser's Talent").id
        );
        const { verdict } = roundTripCard(handWritten);
        expect(verdict).toEqual({ ok: true, kind: "equal" });
    });
});

describe("Class layout — refusals (the card, never a truncation)", () => {
    const bar2 = "{2}{U}: Level 2";
    const anthem = "Creatures you control get +1/+1.";

    it("CR 716.2a — a non-consecutive bar sequence", () => {
        expect(
            refusals([ETB_LINE, bar2, anthem, "{4}{U}: Level 4", anthem])
        ).toEqual([
            "class level bars are consecutive from level 2 (CR 716.2a) — expected level 3, got 4",
        ]);
    });

    it("CR 716.2a — a first bar above level 2", () => {
        expect(refusals([ETB_LINE, "{2}{U}: Level 3", anthem])).toEqual([
            "class level bars are consecutive from level 2 (CR 716.2a) — expected level 2, got 3",
        ]);
    });

    it("CR 716.1 — a Class with no bar", () => {
        expect(refusals([ETB_LINE])).toEqual([
            "a Class card has at least one class level bar (CR 716.1)",
        ]);
    });

    it("a bar whose section holds an unparsed line, with the line itself as the gap", () => {
        const line = "Levitate every goblin in a mysterious fashion.";
        const outcome = compileCard(
            classCard("Test Class", "{U}", [ETB_LINE, bar2, anthem, line])
        );
        if (outcome.state !== "unparsed") throw new Error(outcome.state);
        expect(outcome.gaps.map((g) => g.line)).toEqual([line]);
    });

    it("every section's gaps are reported, for the backlog to rank", () => {
        const a = "Levitate every goblin.";
        const b = "Levitate every kobold.";
        const outcome = compileCard(
            classCard("Test Class", "{U}", [a, bar2, b])
        );
        if (outcome.state !== "unparsed") throw new Error(outcome.state);
        expect(outcome.gaps.map((g) => g.line)).toEqual([a, b]);
    });

    it("a neighbour of the bar's spelling is an ordinary line, and refused", () => {
        const neighbour = "{2}{U}: Level up";
        const outcome = compileCard(
            classCard("Test Class", "{U}", [ETB_LINE, neighbour])
        );
        if (outcome.state !== "unparsed") throw new Error(outcome.state);
        expect(outcome.gaps.map((g) => g.line)).toContain(neighbour);
    });

    it("CR 716.2 — a bar over an empty section", () => {
        expect(refusals([ETB_LINE, bar2])).toEqual([
            "class level 2 section holds no ability",
        ]);
    });

    it("CR 716.2a — a 'becomes level' trigger printed under another bar", () => {
        expect(
            refusals([
                ETB_LINE,
                bar2,
                "When this Class becomes level 3, draw two cards.",
            ])
        ).toEqual(['class level 2 section prints a "becomes level 3" trigger']);
    });

    it("CR 716.3 — a 'becomes level' trigger in the top section", () => {
        expect(
            refusals([
                "When this Class becomes level 2, draw two cards.",
                bar2,
                anthem,
            ])
        ).toEqual([
            'the top section of a Class prints a "becomes level" trigger',
        ]);
    });

    it("CR 716.2a — a section line with no level gate to ride (a definition field)", () => {
        expect(
            refusals([
                ETB_LINE,
                bar2,
                "Play with the top card of your library revealed.",
            ])
        ).toEqual([
            "class level 2 section carries revealsLibraryTop, which has no level gate",
        ]);
    });

    it("CR 716.2a — a section static whose kind has no predicate to gate", () => {
        expect(
            refusals([ETB_LINE, bar2, "Artifacts and lands enter tapped."])
        ).toEqual([
            "class level 2 section holds a enters-tapped-restriction static, which has no level gate",
        ]);
    });
});

describe("Whenever you cast an instant or sorcery spell (CR 205.2a)", () => {
    const creature = (oracleText: string) =>
        compileCard(oracleCard({ oracleText }));

    it("reads as the any-of type filter the hand-written catalogue declares", () => {
        const outcome = creature(
            "Whenever you cast an instant or sorcery spell, draw a card."
        );
        if (outcome.state === "unparsed") throw new Error("unparsed");
        expect(
            outcome.definition.compiledTriggeredAbilities?.[0]?.head
        ).toEqual({
            kind: "spell-cast",
            scope: "you",
            filter: { types: ["Instant", "Sorcery"] },
        });
    });

    it("refuses the neighbour no row spells", () => {
        expect(
            creature(
                "Whenever you cast an instant or creature spell, draw a card."
            ).state
        ).toBe("unparsed");
    });
});

describe("a compiled Class in the engine (CR 716.2a)", () => {
    const ID = "test-8046-compiled-class";

    function withCompiled<T>(
        card: ReturnType<typeof classCard>,
        fn: () => T
    ): T {
        const outcome = compileCard(card);
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        const definition = {
            ...outcome.definition,
            id: ID,
            rarity: "rare",
        } as unknown as CardDefinition;
        return withTemporaryDefinition(definition, fn);
    }

    function board(extra: { id: string; card: string }[] = []) {
        const talent = makeInstance(ID, { id: "talent" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        talent,
                        ...extra.map((e) => makeInstance(e.card, { id: e.id })),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        return { state, talent };
    }

    function levelUp(
        state: ReturnType<typeof board>["state"],
        talent: ReturnType<typeof board>["talent"],
        level: number
    ) {
        state.stack.push({
            ...talent,
            zone: "stack",
            castById: "p1",
            abilityId: `class-level-${level}`,
            targets: [],
        });
        resolveTopOfStack(state);
        state.pendingEvents = [];
    }

    const castInstant = {
        type: "SPELL_CAST",
        casterId: "p1",
        spellInstanceId: "bolt-1",
        spellCardId: getCardByName("Lightning Bolt").id,
        spellTypes: ["Instant"],
        spellSubtypes: [],
        spellColors: ["R"],
    } as const;

    it("the expansion leaves no descriptor on a bar, and one bar ability per level", () => {
        withCompiled(stormchaser(), () => {
            const definition = getDefinition(ID);
            expect(
                definition.classLevelBars?.map((b) =>
                    Object.keys(b).filter((k) => k.startsWith("compiled"))
                )
            ).toEqual([[], []]);
            expect(
                definition.activatedAbilities?.map((a) => a.classLevelBar)
            ).toEqual([2, 3]);
        });
    });

    it("a section trigger exists only from its own level up", () => {
        withCompiled(stormchaser(), () => {
            const { state, talent } = board();
            const fired = () =>
                collectTriggers(state, [castInstant]).map(
                    (t) => t.triggeredAbilityId
                );
            expect(fired()).toEqual([]);
            levelUp(state, talent, 2);
            expect(fired()).toEqual([]);
            levelUp(state, talent, 3);
            expect(fired()).toEqual(["stormchaser-s-talent-trigger-level-3"]);
        });
    });

    it("gaining the level fires the 'becomes level N' trigger of THAT level", () => {
        withCompiled(stormchaser(), () => {
            const { state } = board();
            const gained = (level: number) =>
                collectTriggers(state, [
                    {
                        type: "LEVEL_GAINED",
                        instanceId: "talent",
                        controllerId: "p1",
                        level,
                        previousLevel: level - 1,
                        types: ["Enchantment"],
                        subtypes: ["Class"],
                    },
                ]).map((t) => t.triggeredAbilityId);
            state.players[0].battlefield[0].classLevel = 2;
            expect(gained(2)).toEqual(["stormchaser-s-talent-trigger-level-2"]);
            expect(gained(3)).toEqual([]);
        });
    });

    it("a section anthem buffs only from its level (the layer index sees a bar's static)", () => {
        const card = classCard("Test Class", "{U}", [
            ETB_LINE,
            "{2}{U}: Level 2",
            "Creatures you control get +1/+1.",
        ]);
        withCompiled(card, () => {
            const bear = getCardByName("Grizzly Bears").id;
            const { state, talent } = board([{ id: "bear", card: bear }]);
            const creature = state.players[0].battlefield[1];
            expect(getEffectivePower(state, creature)).toBe(2);
            levelUp(state, talent, 2);
            expect(getEffectivePower(state, creature)).toBe(3);
        });
    });

    function withSection<T>(sectionLine: string, fn: () => T): T {
        const card = classCard("Test Class", "{U}", [
            ETB_LINE,
            "{2}{U}: Level 2",
            ANTHEM_LINE,
            "{4}{U}: Level 3",
            sectionLine,
        ]);
        return withCompiled(card, fn);
    }

    it("CR 601.2f — a section cost modifier reduces only from its level", () => {
        withSection(
            "Noncreature spells you cast cost {1} less to cast.",
            () => {
                const { state, talent } = board();
                const bolt = makeInstance(getCardByName("Lightning Bolt").id, {
                    id: "bolt",
                    controllerId: "p1",
                });
                const bears = makeInstance(getCardByName("Grizzly Bears").id, {
                    id: "bears",
                    controllerId: "p1",
                });
                const reduction = (spell: typeof bolt) =>
                    getCostModifiers(state, spell, "spell").reductionGeneric;
                expect(reduction(bolt)).toBe(0);
                levelUp(state, talent, 2);
                expect(reduction(bolt)).toBe(0);
                levelUp(state, talent, 3);
                expect(reduction(bolt)).toBe(1);
                expect(reduction(bears)).toBe(0);
            }
        );
    });

    it("CR 305.2 — a section's additional land play counts only from its level", () => {
        withSection(
            "You may play an additional land on each of your turns.",
            () => {
                const { state, talent } = board();
                const player = state.players[0];
                const forest = makeInstance(getCardByName("Forest").id, {
                    id: "forest",
                    controllerId: "p1",
                });
                player.hand = [forest];
                player.landsPlayedThisTurn = 1;
                state.activePlayerId = "p1";
                state.priorityPlayerId = "p1";
                state.phase = "PRECOMBAT_MAIN";
                const canPlay = () =>
                    getLegalActions(state, player, forest).includes("play");
                expect(getExtraLandDrops(state, player)).toBe(0);
                expect(canPlay()).toBe(false);
                levelUp(state, talent, 2);
                expect(getExtraLandDrops(state, player)).toBe(0);
                expect(canPlay()).toBe(false);
                levelUp(state, talent, 3);
                expect(getExtraLandDrops(state, player)).toBe(1);
                expect(canPlay()).toBe(true);
            }
        );
    });

    it("CR 401.5 — a section's look reaches only its controller, only from its level (wire)", () => {
        withSection(
            "You may look at the top card of your library any time.",
            () => {
                const { state, talent } = board();
                const top = makeInstance(getCardByName("Forest").id, {
                    id: "top",
                });
                state.players[0].library = [top];
                const known = (viewer: string) =>
                    projectPublicState(state, 1, viewer).players[0].library
                        .known.length;
                expect(known("p1")).toBe(0);
                levelUp(state, talent, 2);
                expect(known("p1")).toBe(0);
                levelUp(state, talent, 3);
                expect(known("p1")).toBe(1);
                expect(known("p2")).toBe(0);
            }
        );
    });

    it("the bar keeps its definition field: nothing is lifted onto the definition", () => {
        withSection(
            "You may play an additional land on each of your turns.",
            () => {
                const definition = getDefinition(ID);
                expect(definition.extraLandDrops).toBeUndefined();
                expect(definition.classLevelBars?.[1]?.extraLandDrops).toBe(1);
            }
        );
    });
});
