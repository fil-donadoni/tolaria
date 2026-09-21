// Divided damage: "deals N damage divided as you choose among <count phrase>
// <targets>" (CR 601.2d / 120.4, issue #4245).
//
// Five layers, each watching a different way the rule can go wrong:
//
//  1. GOLDEN fixtures — a real corpus card compiled whole must produce exactly
//     this Compiled Definition, one per COUNT phrase ("one or two", "one, two,
//     or three", "any number of") and per target-set restriction the sole-gap
//     cards print (bare targets, creatures, creatures with flying, attacking
//     creatures), at every site the corpus prints it (spell, activated,
//     triggered) and with the magnitude a printed number or {X}.
//  2. HAND-WRITTEN equivalence — the compiled Arc Lightning is the shape the
//     catalogue's own Arc Lightning writes.
//  3. REFUSALS — the neighbours the rule must not read (fail-closed).
//  4. LOWERING invariants — what only the group bookkeeping can decide: the
//     divided group is the ONLY group of its ability.
//  5. RESOLUTION — the compiled definition through the real interpreter: the
//     announced split is honoured, and a target that became illegal loses only
//     its own share.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards/catalogue";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition, TargetRequirement } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { getPlayer, resolveTopOfStack } from "../../gre/state";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { TargetSlots } from "../lowerEffects";
import { oracleCard } from "./fixtures";

function spell(
    name: string,
    manaCost: string,
    typeLine: string,
    oracleText: string
) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine,
        power: undefined,
        toughness: undefined,
    });
}

function creature(
    name: string,
    manaCost: string,
    typeLine: string,
    oracleText: string,
    stats: string
) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine,
        power: stats,
        toughness: stats,
    });
}

/** Compile a card and return its definition, failing the test if refused. */
function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

const refused = (card: ReturnType<typeof oracleCard>) =>
    compileCard(card).state === "unparsed";

/** The divide budget the rule attaches to a group. */
const divided = (total: number | "X") => ({ total });

describe("divided damage — golden fixtures (CR 601.2d / 120.4)", () => {
    it("spell · one, two, or three targets (Arc Lightning)", () => {
        const text =
            "Arc Lightning deals 3 damage divided as you choose among one, two, or three targets.";
        expect(
            sortKeys(
                compiled(spell("Arc Lightning", "{2}{R}", "Sorcery", text))
            )
        ).toEqual(
            sortKeys({
                name: "Arc Lightning",
                types: ["Sorcery"],
                manaCost: { X: 2, R: 1 },
                oracleText: text,
                effects: [{ op: "dealDamageDividedAsChosen", total: 3 }],
                targetRequirement: {
                    type: "any",
                    count: { min: 1 },
                    divideAsChosen: divided(3),
                },
            })
        );
    });

    it("spell · one or two targets (Forked Bolt)", () => {
        const text =
            "Forked Bolt deals 2 damage divided as you choose among one or two targets.";
        expect(
            sortKeys(compiled(spell("Forked Bolt", "{R}", "Sorcery", text)))
        ).toEqual(
            sortKeys({
                name: "Forked Bolt",
                types: ["Sorcery"],
                manaCost: { R: 1 },
                oracleText: text,
                effects: [{ op: "dealDamageDividedAsChosen", total: 2 }],
                targetRequirement: {
                    type: "any",
                    count: { min: 1 },
                    divideAsChosen: divided(2),
                },
            })
        );
    });

    it("spell · a printed maximum BELOW the budget is a real limit (Forked Lightning)", () => {
        // 4 damage over at most three creatures: the budget alone would allow
        // four targets, so `max: 3` must survive.
        const text =
            "Forked Lightning deals 4 damage divided as you choose among one, two, or three target creatures.";
        expect(
            sortKeys(
                compiled(spell("Forked Lightning", "{3}{R}", "Sorcery", text))
            )
        ).toEqual(
            sortKeys({
                name: "Forked Lightning",
                types: ["Sorcery"],
                manaCost: { X: 3, R: 1 },
                oracleText: text,
                effects: [{ op: "dealDamageDividedAsChosen", total: 4 }],
                targetRequirement: {
                    type: "Creature",
                    count: { min: 1, max: 3 },
                    divideAsChosen: divided(4),
                },
            })
        );
    });

    it("spell · any number of targets (Pyrotechnics)", () => {
        const text =
            "Pyrotechnics deals 4 damage divided as you choose among any number of targets.";
        expect(
            sortKeys(compiled(spell("Pyrotechnics", "{4}{R}", "Sorcery", text)))
        ).toEqual(
            sortKeys({
                name: "Pyrotechnics",
                types: ["Sorcery"],
                manaCost: { X: 4, R: 1 },
                oracleText: text,
                effects: [{ op: "dealDamageDividedAsChosen", total: 4 }],
                targetRequirement: {
                    type: "any",
                    count: { min: 1 },
                    divideAsChosen: divided(4),
                },
            })
        );
    });

    it("spell · any number of target creatures (Spreading Flames)", () => {
        const text =
            "Spreading Flames deals 6 damage divided as you choose among any number of target creatures.";
        expect(
            sortKeys(
                compiled(spell("Spreading Flames", "{5}{R}", "Sorcery", text))
            )
        ).toEqual(
            sortKeys({
                name: "Spreading Flames",
                types: ["Sorcery"],
                manaCost: { X: 5, R: 1 },
                oracleText: text,
                effects: [{ op: "dealDamageDividedAsChosen", total: 6 }],
                targetRequirement: {
                    type: "Creature",
                    count: { min: 1 },
                    divideAsChosen: divided(6),
                },
            })
        );
    });

    it("spell · target creatures with flying (Aerial Volley)", () => {
        const text =
            "Aerial Volley deals 3 damage divided as you choose among one, two, or three target creatures with flying.";
        expect(
            sortKeys(
                compiled(spell("Aerial Volley", "{2}{R}", "Instant", text))
            )
        ).toEqual(
            sortKeys({
                name: "Aerial Volley",
                types: ["Instant"],
                manaCost: { X: 2, R: 1 },
                oracleText: text,
                effects: [{ op: "dealDamageDividedAsChosen", total: 3 }],
                targetRequirement: {
                    type: "Creature",
                    count: { min: 1 },
                    requireAbility: "flying",
                    divideAsChosen: divided(3),
                },
            })
        );
    });

    it("spell · X damage among target attacking creatures (Hail of Arrows)", () => {
        const text =
            "Hail of Arrows deals X damage divided as you choose among any number of target attacking creatures.";
        expect(
            sortKeys(
                compiled(spell("Hail of Arrows", "{X}{W}", "Instant", text))
            )
        ).toEqual(
            sortKeys({
                name: "Hail of Arrows",
                types: ["Instant"],
                manaCost: { X: "X", W: 1 },
                oracleText: text,
                effects: [{ op: "dealDamageDividedAsChosen", total: "X" }],
                targetRequirement: {
                    type: "Creature",
                    count: { min: 1 },
                    combatRoleFilter: ["attacking"],
                    divideAsChosen: divided("X"),
                },
            })
        );
    });

    it("spell · X damage among any number of targets (Rolling Thunder)", () => {
        const text =
            "Rolling Thunder deals X damage divided as you choose among any number of targets.";
        expect(
            sortKeys(
                compiled(spell("Rolling Thunder", "{X}{R}{R}", "Sorcery", text))
            )
        ).toEqual(
            sortKeys({
                name: "Rolling Thunder",
                types: ["Sorcery"],
                manaCost: { X: "X", R: 2 },
                oracleText: text,
                effects: [{ op: "dealDamageDividedAsChosen", total: "X" }],
                targetRequirement: {
                    type: "any",
                    count: { min: 1 },
                    divideAsChosen: divided("X"),
                },
            })
        );
    });

    it("spell · a second sentence rides after the division (Electrolyze)", () => {
        const text =
            "Electrolyze deals 2 damage divided as you choose among one or two targets.\nDraw a card.";
        expect(
            sortKeys(
                compiled(spell("Electrolyze", "{1}{U}{R}", "Instant", text))
            )
        ).toEqual(
            sortKeys({
                name: "Electrolyze",
                types: ["Instant"],
                manaCost: { X: 1, U: 1, R: 1 },
                oracleText: text,
                effects: [
                    { op: "dealDamageDividedAsChosen", total: 2 },
                    { op: "draw", player: "controller", count: 1 },
                ],
                targetRequirement: {
                    type: "any",
                    count: { min: 1 },
                    divideAsChosen: divided(2),
                },
            })
        );
    });

    it("activated · this creature deals (Arc Mage)", () => {
        const text =
            "{2}{R}, {T}, Discard a card: This creature deals 2 damage divided as you choose among one or two targets.";
        expect(
            sortKeys(
                compiled(
                    creature(
                        "Arc Mage",
                        "{2}{R}",
                        "Creature — Human Wizard",
                        text,
                        "2"
                    )
                )
            )
        ).toEqual(
            sortKeys({
                name: "Arc Mage",
                types: ["Creature"],
                subtypes: ["Human", "Wizard"],
                manaCost: { X: 2, R: 1 },
                power: 2,
                toughness: 2,
                oracleText: text,
                activatedAbilities: [
                    {
                        id: "arc-mage-ability",
                        oracleText: text,
                        cost: {
                            mana: { X: 2, R: 1 },
                            tap: true,
                            discardFilter: { filter: {}, count: 1 },
                        },
                        useStack: true,
                        effects: [
                            { op: "dealDamageDividedAsChosen", total: 2 },
                        ],
                        targetRequirement: {
                            type: "any",
                            count: { min: 1 },
                            divideAsChosen: divided(2),
                        },
                    },
                ],
            })
        );
    });

    it("activated · the bound pronoun deals (Mogg Mob)", () => {
        const text =
            "Sacrifice this creature: It deals 3 damage divided as you choose among one, two, or three targets.";
        const definition = compiled(
            creature("Mogg Mob", "{2}{R}", "Creature — Goblin", text, "1")
        );
        expect(sortKeys(definition.activatedAbilities)).toEqual(
            sortKeys([
                {
                    id: "mogg-mob-ability",
                    oracleText: text,
                    cost: { sacrifice: true },
                    useStack: true,
                    effects: [{ op: "dealDamageDividedAsChosen", total: 3 }],
                    targetRequirement: {
                        type: "any",
                        count: { min: 1 },
                        divideAsChosen: divided(3),
                    },
                },
            ])
        );
    });

    it("triggered · it deals, on a dies head (Gang of Devils)", () => {
        const text =
            "When this creature dies, it deals 3 damage divided as you choose among one, two, or three targets.";
        const definition = compiled(
            creature(
                "Gang of Devils",
                "{3}{R}{R}",
                "Creature — Devil",
                text,
                "3"
            )
        );
        expect(sortKeys(definition.compiledTriggeredAbilities)).toEqual(
            sortKeys([
                {
                    id: "gang-of-devils-trigger",
                    oracleText: text,
                    head: { kind: "died", scope: "self" },
                    targetRequirement: {
                        type: "any",
                        count: { min: 1 },
                        divideAsChosen: divided(3),
                    },
                    effects: [{ op: "dealDamageDividedAsChosen", total: 3 }],
                },
            ])
        );
    });

    it("triggered · any number of targets, on an enters head (Bogardan Hellkite)", () => {
        const text =
            "When this creature enters, it deals 5 damage divided as you choose among any number of targets.";
        const definition = compiled(
            creature(
                "Bogardan Hellkite",
                "{6}{R}{R}",
                "Creature — Dragon",
                `Flash\nFlying\n${text}`,
                "5"
            )
        );
        expect(sortKeys(definition.compiledTriggeredAbilities)).toEqual(
            sortKeys([
                {
                    id: "bogardan-hellkite-trigger",
                    oracleText: text,
                    head: { kind: "entered", scope: "self" },
                    targetRequirement: {
                        type: "any",
                        count: { min: 1 },
                        divideAsChosen: divided(5),
                    },
                    effects: [{ op: "dealDamageDividedAsChosen", total: 5 }],
                },
            ])
        );
    });
});

describe("divided damage — reaches ready", () => {
    // The smoke planner cannot scenario-ize an announced division, so a
    // divided card is `ready` only because the `divided damage` golden fixture
    // (`grammar/fixtures.ts`) exhibits the form — at every site that prints it.
    it.each([
        [
            "spell",
            spell(
                "Arc Lightning",
                "{2}{R}",
                "Sorcery",
                "Arc Lightning deals 3 damage divided as you choose among one, two, or three targets."
            ),
        ],
        [
            "activated ability",
            creature(
                "Mogg Mob",
                "{2}{R}",
                "Creature — Goblin",
                "Sacrifice this creature: It deals 3 damage divided as you choose among one, two, or three targets.",
                "1"
            ),
        ],
        [
            "triggered ability",
            creature(
                "Gang of Devils",
                "{3}{R}{R}",
                "Creature — Devil",
                "When this creature dies, it deals 3 damage divided as you choose among one, two, or three targets.",
                "3"
            ),
        ],
    ])("%s", (_site, card) => {
        expect(compileCard(card).state).toBe("ready");
    });
});

describe("divided damage — the hand-written catalogue's shape", () => {
    it("the compiled Arc Lightning equals the hand-written one (effects + targetRequirement)", () => {
        const handWritten = getCardByName("Arc Lightning");
        const definition = compiled(
            spell(
                "Arc Lightning",
                "{2}{R}",
                "Sorcery",
                "Arc Lightning deals 3 damage divided as you choose among one, two, or three targets."
            )
        );
        expect(definition.effects).toEqual(handWritten.effects);
        expect(definition.targetRequirement).toEqual(
            handWritten.targetRequirement
        );
    });
});

describe("divided damage — refused neighbours (fail-closed)", () => {
    const line = (name: string, cost: string, text: string) =>
        spell(name, cost, "Instant", text);

    it("refuses 'attacking or blocking' — the descriptor cannot read the disjunction (Deft Dismissal)", () => {
        expect(
            refused(
                line(
                    "Deft Dismissal",
                    "{3}{W}",
                    "Deft Dismissal deals 3 damage divided as you choose among one, two, or three target attacking or blocking creatures."
                )
            )
        ).toBe(true);
    });

    it("refuses 'and/or' — the descriptor cannot read the conjunction (Ignite Disorder)", () => {
        expect(
            refused(
                line(
                    "Ignite Disorder",
                    "{1}{R}",
                    "Ignite Disorder deals 3 damage divided as you choose among one, two, or three target white and/or blue creatures."
                )
            )
        ).toBe(true);
    });

    it("refuses an 'X target …' count — its width is a fact about the cast (Meteor Swarm)", () => {
        expect(
            refused(
                line(
                    "Meteor Swarm",
                    "{X}{R}{R}{R}",
                    "Meteor Swarm deals 8 damage divided as you choose among X target creatures and/or planeswalkers."
                )
            )
        ).toBe(true);
    });

    it("refuses a magnitude that is not a number or X (Meteor Shower: 'X plus 1')", () => {
        expect(
            refused(
                line(
                    "Meteor Shower",
                    "{X}{R}",
                    "Meteor Shower deals X plus 1 damage divided as you choose among any number of targets."
                )
            )
        ).toBe(true);
    });

    it("refuses an even split — CR 601.2d is the caster's division (Fireball)", () => {
        expect(
            refused(
                line(
                    "Fireball",
                    "{X}{R}",
                    "Fireball deals X damage divided evenly, rounded down, among any number of targets."
                )
            )
        ).toBe(true);
    });

    it("refuses damage 'equal to its power' — a separate magnitude reference (Living Inferno)", () => {
        expect(
            refused(
                creature(
                    "Living Inferno",
                    "{2}{R}{R}",
                    "Creature — Elemental",
                    "{T}: This creature deals damage equal to its power divided as you choose among any number of target creatures.",
                    "3"
                )
            )
        ).toBe(true);
    });

    it("refuses a second target group beside the division — the budget would swallow it (Fiery Justice)", () => {
        expect(
            refused(
                line(
                    "Fiery Justice",
                    "{R}{G}{W}",
                    "Fiery Justice deals 5 damage divided as you choose among any number of targets. Target opponent gains 5 life."
                )
            )
        ).toBe(true);
    });

    it("refuses an X magnitude on a source that announces no {X}", () => {
        expect(
            refused(
                line(
                    "No X Probe",
                    "{2}{R}",
                    "No X Probe deals X damage divided as you choose among any number of targets."
                )
            )
        ).toBe(true);
    });

    it("refuses a bare plural count with no phrase ('two targets') — a form nobody prints", () => {
        expect(
            refused(
                line(
                    "Two Probe",
                    "{2}{R}",
                    "Two Probe deals 2 damage divided as you choose among two targets."
                )
            )
        ).toBe(true);
    });

    it("refuses a divided 'instead' upgrade — it replaces a base the divide cannot restate (Fight with Fire)", () => {
        expect(
            refused(
                line(
                    "Fight with Fire",
                    "{2}{R}",
                    "Fight with Fire deals 5 damage to target creature. If this spell was kicked, it deals 10 damage divided as you choose among any number of targets instead."
                )
            )
        ).toBe(true);
    });
});

describe("divided damage — lowering invariants", () => {
    const group = (count: TargetRequirement["count"]): TargetRequirement => ({
        type: "any",
        count,
        divideAsChosen: { total: 3 },
    });

    it("a divided group after another target group is refused", () => {
        const slots = new TargetSlots();
        expect(slots.allocate({ type: "player", count: 1 }).ok).toBe(true);
        const second = slots.allocate(group({ min: 1 }));
        expect(second.ok).toBe(false);
    });

    it("a divided group is admitted first, with no positional width", () => {
        const slots = new TargetSlots();
        const first = slots.allocate(group({ min: 1 }));
        expect(first).toEqual({ ok: true, value: 0 });
    });

    it("no group may follow a divided one", () => {
        const slots = new TargetSlots();
        slots.allocate(group({ min: 1 }));
        expect(slots.allocate({ type: "player", count: 1 }).ok).toBe(false);
    });

    it("an OPEN count is refused on a group that is not divided", () => {
        const slots = new TargetSlots();
        expect(slots.allocate({ type: "any", count: { min: 1 } }).ok).toBe(
            false
        );
    });
});

describe("divided damage — resolution through the interpreter (CR 601.2d / 120.4)", () => {
    // A 4/4, so the split (at most 3 on one creature) never kills it and the
    // marked damage stays observable.
    const BEAR = getCardByName("Serra Angel").id;

    function withCompiled<T>(
        card: ReturnType<typeof oracleCard>,
        fn: (id: string) => T
    ): T {
        const id = `test-4245-${card.name.toLowerCase().replace(/\W+/g, "-")}`;
        const definition = {
            ...compiled(card),
            id,
            rarity: "common",
        } as unknown as CardDefinition;
        return withTemporaryDefinition(definition, () => fn(id));
    }

    const arcLightning = spell(
        "Arc Lightning Probe",
        "{2}{R}",
        "Sorcery",
        "Arc Lightning Probe deals 3 damage divided as you choose among one, two, or three targets."
    );

    function board() {
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(BEAR, {
                            controllerId: "p2",
                            ownerId: "p2",
                            id: "bearA",
                        }),
                        makeInstance(BEAR, {
                            controllerId: "p2",
                            ownerId: "p2",
                            id: "bearB",
                        }),
                    ],
                }),
            ],
        });
    }

    const damageOn = (
        state: ReturnType<typeof board>,
        id: string
    ): number | undefined =>
        getPlayer(state, "p2").battlefield.find((c) => c.id === id)
            ?.damageMarked;

    it("honours the announced split", () => {
        withCompiled(arcLightning, (id) => {
            const state = board();
            const item = pushSpell(state, id, "p1", [
                { type: "permanent", id: "bearA" },
                { type: "permanent", id: "bearB" },
            ]);
            item.targetAmounts = { "permanent:bearA": 2, "permanent:bearB": 1 };
            resolveTopOfStack(state);
            expect(damageOn(state, "bearA")).toBe(2);
            expect(damageOn(state, "bearB")).toBe(1);
        });
    });

    it("a target that became illegal loses only its own share (CR 608.2b)", () => {
        withCompiled(arcLightning, (id) => {
            const state = board();
            const item = pushSpell(state, id, "p1", [
                { type: "permanent", id: "bearA" },
                { type: "permanent", id: "bearB" },
            ]);
            item.targetAmounts = { "permanent:bearA": 2, "permanent:bearB": 1 };
            // bearB leaves the battlefield before the spell resolves.
            const p2 = getPlayer(state, "p2");
            p2.battlefield = p2.battlefield.filter((c) => c.id !== "bearB");
            resolveTopOfStack(state);
            expect(damageOn(state, "bearA")).toBe(2);
            expect(damageOn(state, "bearB")).toBeUndefined();
        });
    });

    it("resolves a compiled X budget against the announced {X}", () => {
        withCompiled(
            spell(
                "Rolling Thunder Probe",
                "{X}{R}{R}",
                "Sorcery",
                "Rolling Thunder Probe deals X damage divided as you choose among any number of targets."
            ),
            (id) => {
                const state = board();
                const item = pushSpell(state, id, "p1", [
                    { type: "permanent", id: "bearA" },
                    { type: "permanent", id: "bearB" },
                ]);
                item.chosenX = 4;
                item.targetAmounts = {
                    "permanent:bearA": 3,
                    "permanent:bearB": 1,
                };
                resolveTopOfStack(state);
                expect(damageOn(state, "bearA")).toBe(3);
                expect(damageOn(state, "bearB")).toBe(1);
            }
        );
    });
});
