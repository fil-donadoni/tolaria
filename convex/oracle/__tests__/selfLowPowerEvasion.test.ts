// "<self> can't be blocked by creatures with power N or less" — CR 509.1b, an
// evasion restriction bounded on the blocker's power (CR 208.1).
//
// GOLDEN (a real corpus card compiled whole), the `{self}` form at clause
// level, REFUSALS (the printed neighbours stay unparsed), BEHAVIOUR (the
// compiled definition, registered as-is, at the real combat seam, engine and
// projected board agreeing) and the evaluator's two bounds.

import { describe, expect, it } from "vitest";
import { matchesCombatCounterpart } from "../../cards/abilities/static/blockRestriction";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition, PermanentView } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { validateBlockerEligibility } from "../../gre/combat";
import type { CardInstanceState, GameState } from "../../gre/state";
import { projectPublicState } from "../../gameProjections";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { staticSlot } from "../grammar/slots/staticSlot";
import { oracleCard, parseContext } from "./oracle.fixture";

const LOW_POWER =
    "This creature can't be blocked by creatures with power 2 or less.";

const STEEL_LEAF_CHAMPION = oracleCard({
    oracleId: "666af637-9282-4121-962a-048e528f9221",
    name: "Steel Leaf Champion",
    manaCost: "{G}{G}{G}",
    typeLine: "Creature — Elf Knight",
    oracleText: LOW_POWER,
    power: "5",
    toughness: "4",
});

const STOMPER_LINE =
    "This Vehicle can't be blocked by creatures with power 2 or less.";
const CREW_5 =
    "Crew 5 (Tap any number of creatures you control with total power 5 or more: This Vehicle becomes an artifact creature until end of turn.)";

const DEMOLITION_STOMPER = oracleCard({
    oracleId: "282e5e5f-365a-4e11-aeac-ead71d1cf68a",
    name: "Demolition Stomper",
    manaCost: "{6}",
    typeLine: "Artifact — Vehicle",
    oracleText: `${STOMPER_LINE}\n${CREW_5}`,
    power: "10",
    toughness: "7",
});

function compiled(card: ReturnType<typeof oracleCard>): CardDefinition {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(`${card.name} ${outcome.state}`);
    return outcome.definition as CardDefinition;
}

function clauseOf(line: string) {
    const parsed = staticSlot.run(line, parseContext());
    if (!parsed.ok || parsed.value.kind !== "static")
        throw new Error(`"${line}" is not a static line`);
    return parsed.value.clause;
}

describe("can't be blocked by creatures with power N or less (CR 509.1b)", () => {
    it("Steel Leaf Champion: the whole compiled definition", () => {
        expect(sortKeys(compiled(STEEL_LEAF_CHAMPION))).toEqual(
            sortKeys({
                name: "Steel Leaf Champion",
                types: ["Creature"],
                subtypes: ["Elf", "Knight"],
                manaCost: { G: 3 },
                power: 5,
                toughness: 4,
                oracleText: LOW_POWER,
                compiledStaticEffects: [
                    {
                        kind: "block-restriction",
                        id: "steel-leaf-champion-cant-be-blocked-by",
                        oracleText: LOW_POWER,
                        neverAgainst: { power: { max: 2 } },
                    },
                ],
            })
        );
    });

    it("Demolition Stomper: the This Vehicle form, compiled whole", () => {
        expect(sortKeys(compiled(DEMOLITION_STOMPER))).toEqual(
            sortKeys({
                name: "Demolition Stomper",
                types: ["Artifact"],
                subtypes: ["Vehicle"],
                manaCost: { X: 6 },
                oracleText: `${STOMPER_LINE}\n${CREW_5}`,
                staticAbilities: ["crew 5"],
                activatedAbilities: [
                    {
                        id: "demolition-stomper-crew",
                        oracleText: CREW_5,
                        cost: {
                            tapOtherFilter: {
                                filter: {
                                    types: "Creature",
                                    controllerRelation: "you",
                                },
                                totalPower: 5,
                            },
                        },
                        useStack: true,
                        animatesSelf: true,
                        effects: [
                            {
                                op: "animate",
                                target: { ref: "$source" },
                                power: 10,
                                toughness: 7,
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                    },
                ],
                compiledStaticEffects: [
                    {
                        kind: "block-restriction",
                        id: "demolition-stomper-cant-be-blocked-by",
                        oracleText: STOMPER_LINE,
                        neverAgainst: { power: { max: 2 } },
                    },
                ],
                power: 10,
                toughness: 7,
            })
        );
    });

    it("reads the {self} form and the printed bound (Questing Beast, War-Name Aspirant, Dread Linnorm)", () => {
        for (const [line, max] of [
            ["{self} can't be blocked by creatures with power 2 or less.", 2],
            [
                "This creature can't be blocked by creatures with power 1 or less.",
                1,
            ],
            [
                "This creature can't be blocked by creatures with power 3 or less.",
                3,
            ],
        ] as const) {
            expect(clauseOf(line)).toEqual({
                kind: "self-evasion-restriction",
                neverAgainst: { power: { max } },
                sentence: line,
            });
        }
    });

    for (const line of [
        // the opposite bound: its own form, not read here
        "This creature can't be blocked by creatures with power 3 or greater.",
        "This creature can't be blocked by creatures with power or toughness 2 or less.",
        "This creature can't be blocked by creatures with power less than this creature's power.",
        "This creature can't block creatures with power 2 or less.",
        "Enchanted creature can't be blocked by creatures with power 2 or less.",
        "This creature can't be blocked by creatures with power 2 or less this turn.",
        "Target creature can't be blocked by creatures with power 2 or less.",
    ])
        it(`REFUSES "${line}"`, () => {
            expect(staticSlot.run(line, parseContext()).ok).toBe(false);
        });

    const CHAMPION = "compiled-steel-leaf-champion";
    const BEAR = "compiled-bear";
    const withCreatures = <T>(fn: () => T): T =>
        withTemporaryDefinition(
            {
                ...compiled(STEEL_LEAF_CHAMPION),
                id: CHAMPION,
                rarity: "common",
            } as CardDefinition,
            () =>
                withTemporaryDefinition(
                    {
                        ...compiled(
                            oracleCard({
                                name: "Bear",
                                manaCost: "{1}{G}",
                                power: "2",
                                toughness: "2",
                            })
                        ),
                        id: BEAR,
                        rarity: "common",
                    } as CardDefinition,
                    fn
                )
        );

    function board(
        mine: CardInstanceState[],
        theirs: CardInstanceState[]
    ): GameState {
        return makeState({
            turn: 3,
            phase: "DECLARE_ATTACKERS",
            players: [
                makePlayer("p1", { battlefield: mine }),
                makePlayer("p2", { battlefield: theirs }),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            combat: {
                attackerIds: [],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
    }

    /** Can `blockerDef` block `attackerDef`? Asked of the engine's board and
     *  of the projected one, which must agree. */
    function canBlock(
        attackerDef: string,
        blockerDef: string,
        blockerExtra: Partial<CardInstanceState> = {}
    ): boolean {
        const attacker = makeInstance(attackerDef, {
            id: "attacker",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blocker = makeInstance(blockerDef, {
            id: "blocker",
            controllerId: "p2",
            ownerId: "p2",
            ...blockerExtra,
        });
        const state = board([attacker], [blocker]);
        const engine = validateBlockerEligibility(
            attacker,
            blocker,
            [blocker],
            state
        ).eligible;
        const projected = projectPublicState(state, 1, "p2");
        const slim = (id: string) =>
            projected.players
                .flatMap((p) => p.battlefield)
                .find((c) => c.id === id) as never;
        const wire = validateBlockerEligibility(
            slim("attacker"),
            slim("blocker"),
            [slim("blocker")],
            projected as never
        ).eligible;
        expect(wire).toBe(engine);
        return engine;
    }

    it("refuses a power-2 blocker, allows a power-3 one; attacker side only", () => {
        withCreatures(() => {
            expect(canBlock(CHAMPION, BEAR)).toBe(false);
            expect(canBlock(CHAMPION, CHAMPION)).toBe(true);
            // It may still block a small attacker.
            expect(canBlock(BEAR, CHAMPION)).toBe(true);
        });
    });

    it("reads the blocker's EFFECTIVE power (CR 613.4)", () => {
        withCreatures(() => {
            // A +1/+1 counter lifts the Bear to power 3: it may block.
            expect(canBlock(CHAMPION, BEAR, { counters: { "+1/+1": 1 } })).toBe(
                true
            );
        });
    });
});

describe("the power counterpart filter's bounds are inclusive (CR 208.1)", () => {
    const view = (power: number) => ({ power }) as unknown as PermanentView;

    it("max: power at or below the bound matches", () => {
        const filter = { power: { max: 2 } };
        expect(matchesCombatCounterpart(filter, view(2))).toBe(true);
        expect(matchesCombatCounterpart(filter, view(3))).toBe(false);
    });

    it("min: power at or above the bound matches", () => {
        const filter = { power: { min: 2 } };
        expect(matchesCombatCounterpart(filter, view(2))).toBe(true);
        expect(matchesCombatCounterpart(filter, view(1))).toBe(false);
    });
});
