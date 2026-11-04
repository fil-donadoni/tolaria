// CR 608.2 — the canned scenario for a `forEach` mass effect: a seeded board of
// members and bystanders, resolved through the real `resolveTopOfStack`. A plan
// that holds on the script it was built from must break on a script whose
// selector reads wider, or it proves nothing about the selector.

import { beforeAll, describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../../cards";
import type { EffectCardFilter, EffectOp } from "../../../cards/types";
import { makeInstance } from "../../../cards/__tests__/setup.helper";
import { oracleCard } from "../../../oracle/__tests__/oracle.fixture";
import { compileCard } from "../../../oracle/compile";
import { resolveTopOfStack } from "../../state";
import {
    abilityHost,
    CASTER_ID,
    FILLER_CARD_DEFINITION,
    planSmokeTest,
    SMOKE_SKIP_CLASS,
    type Plan,
    type SmokeHost,
} from "../scenarioGenerator";

type RunPlan = Extract<Plan, { kind: "run" }>;

const UNMODELLED = `construct "forEach" iterates a runtime-selected set — covered by the card's own tests`;

const DESTROY = { op: "destroy", target: { ref: "$each" } };
const TAP = { op: "tapUntap", action: "tap", target: { ref: "$each" } };
const UNTAP = { op: "tapUntap", action: "untap", target: { ref: "$each" } };
const BOUNCE = { op: "moveZone", target: { ref: "$each" }, to: "hand" };
const PUMP = {
    op: "pump",
    target: { ref: "$each" },
    power: 1,
    toughness: 1,
    duration: { phase: "end-of-turn" },
};
const DAMAGE_X = {
    op: "dealDamage",
    amount: { X: true },
    to: { ref: "$each" },
};

function sweep(
    body: object,
    filter: EffectCardFilter | undefined,
    extra: object = {}
): EffectOp {
    return {
        op: "forEach",
        select: {
            set: "permanents",
            zone: "battlefield",
            ...(filter === undefined ? {} : { filter }),
            ...extra,
        },
        effects: [body],
    } as unknown as EffectOp;
}

function runPlan(effects: readonly EffectOp[], host?: SmokeHost): RunPlan {
    const plan = planSmokeTest(effects, host);
    if (plan.kind !== "run")
        throw new Error(`expected a run plan, got skip: ${plan.reason}`);
    return plan;
}

let spellCounter = 0;

/** Resolves `effects` as a spell on the plan's board. */
function resolveSpell(plan: RunPlan, effects: readonly EffectOp[]): void {
    const id = `sweep-spell-${spellCounter++}`;
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        effects: [...effects],
    });
    plan.scenario.state.stack.push({
        ...makeInstance(id, {
            controllerId: CASTER_ID,
            ownerId: CASTER_ID,
            zone: "hand",
        }),
        castById: CASTER_ID,
        targets: plan.scenario.targets,
        ...(plan.scenario.chosenX === undefined
            ? {}
            : { chosenX: plan.scenario.chosenX }),
    });
    resolveTopOfStack(plan.scenario.state);
}

/** Resolves `effects` as an activated ability of the plan's seeded source. */
function resolveAbility(plan: RunPlan, effects: readonly EffectOp[]): void {
    const id = `sweep-ability-${spellCounter++}`;
    const abilityId = `${id}-ab`;
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Creature"],
        power: 3,
        toughness: 3,
        activatedAbilities: [
            {
                id: abilityId,
                oracleText: "smoke",
                cost: { tap: true },
                useStack: true,
                effects: [...effects],
            },
        ],
    });
    const source = makeInstance(id, {
        id: plan.scenario.sourcePermanentId!,
        controllerId: CASTER_ID,
        ownerId: CASTER_ID,
        zone: "stack",
    });
    plan.scenario.state.stack.push({
        ...source,
        castById: CASTER_ID,
        abilityId,
        targets: plan.scenario.targets,
    });
    resolveTopOfStack(plan.scenario.state);
}

function failures(plan: RunPlan): string[] {
    return plan.assertions
        .map((a) => ({ label: a.label, result: a.check(plan.scenario.state) }))
        .filter(({ result }) => !result.ok)
        .map(({ label, result }) => `${label}: ${result.detail ?? ""}`);
}

function skipReasons(effects: readonly EffectOp[]): string[] {
    const plan = planSmokeTest(effects);
    return plan.kind === "skip" ? plan.skips.map((s) => s.reason) : [];
}

beforeAll(() => {
    registerTokenDefinition(FILLER_CARD_DEFINITION);
});

describe("a mass effect's declared outcome holds on the seeded board (CR 608.2)", () => {
    const SHAPES: [string, EffectOp[]][] = [
        ["destroy, by type", [sweep(DESTROY, { type: "Artifact" })]],
        [
            "destroy, by an OR of types",
            [sweep(DESTROY, { type: ["Creature", "Land"] })],
        ],
        ["destroy, by a land subtype", [sweep(DESTROY, { subtype: "Island" })]],
        [
            "destroy, by colour",
            [sweep(DESTROY, { type: "Creature", color: "B" })],
        ],
        [
            "destroy, regeneration barred",
            [
                sweep(
                    { ...DESTROY, cantBeRegenerated: true },
                    { type: "Artifact" }
                ),
            ],
        ],
        [
            "destroy, excluding a type",
            [sweep(DESTROY, { excludeType: "Artifact" })],
        ],
        [
            "destroy, type minus subtype",
            [sweep(DESTROY, { type: "Creature", excludeSubtype: "Giant" })],
        ],
        ["tap", [sweep(TAP, { type: "Artifact" })]],
        [
            "untap, your side only",
            [
                sweep(
                    UNTAP,
                    { excludeType: "Land" },
                    { controller: "controller" }
                ),
            ],
        ],
        ["bounce", [sweep(BOUNCE, { type: "Artifact" })]],
        [
            "bounce, excluding two types",
            [sweep(BOUNCE, { excludeType: ["Creature", "Land"] })],
        ],
        [
            "pump, your side only",
            [sweep(PUMP, { subtype: "Vampire" }, { controller: "controller" })],
        ],
        [
            "damage, without a keyword",
            [sweep(DAMAGE_X, { type: "Creature", excludeAbility: "flying" })],
        ],
        [
            "damage to each player beside a creature sweep",
            [
                sweep(DAMAGE_X, { type: "Creature" }),
                {
                    op: "forEach",
                    select: { set: "players" },
                    effects: [
                        {
                            op: "dealDamage",
                            amount: { X: true },
                            to: { player: { ref: "$each" } },
                        },
                    ],
                } as unknown as EffectOp,
            ],
        ],
        [
            "a targeted player's side, beside a drain",
            [
                sweep(TAP, { type: "Land" }, { controller: { target: 0 } }),
                {
                    op: "drainManaPool",
                    player: { target: 0 },
                } as unknown as EffectOp,
            ],
        ],
        [
            "the mana value guard of 'X or less'",
            [
                sweep(
                    {
                        op: "if",
                        predicate: {
                            left: { manaValue: { of: { ref: "$each" } } },
                            op: "le",
                            right: { X: true },
                        },
                        then: [DESTROY],
                    },
                    { type: "Artifact" }
                ),
            ],
        ],
    ];

    it.each(SHAPES)("%s", (_label, effects) => {
        const plan = runPlan(effects);
        resolveSpell(plan, effects);
        expect(plan.assertions.length).toBeGreaterThan(0);
        expect(failures(plan)).toEqual([]);
    });
});

describe("a sweep that reads wider than its selector breaks the plan (CR 608.2)", () => {
    const CLAUSES: [string, EffectOp, EffectOp][] = [
        [
            "type",
            sweep(DESTROY, { type: "Artifact" }),
            sweep(DESTROY, undefined),
        ],
        [
            "subtype",
            sweep(DESTROY, { type: "Creature", subtype: "Elf" }),
            sweep(DESTROY, { type: "Creature" }),
        ],
        [
            "colour",
            sweep(DESTROY, { type: "Creature", color: "B" }),
            sweep(DESTROY, { type: "Creature" }),
        ],
        [
            "excluded type",
            sweep(DESTROY, { type: "Creature", excludeType: "Artifact" }),
            sweep(DESTROY, { type: "Creature" }),
        ],
        [
            "excluded subtype",
            sweep(DESTROY, { type: "Creature", excludeSubtype: "Giant" }),
            sweep(DESTROY, { type: "Creature" }),
        ],
        [
            "excluded keyword",
            sweep(TAP, { type: "Creature", excludeAbility: "flying" }),
            sweep(TAP, { type: "Creature" }),
        ],
        [
            "controller",
            sweep(UNTAP, { type: "Creature" }, { controller: "controller" }),
            sweep(UNTAP, { type: "Creature" }),
        ],
    ];

    it.each(CLAUSES)("the %s clause", (_label, narrow, wide) => {
        const plan = runPlan([narrow]);
        resolveSpell(plan, [wide]);
        expect(failures(plan)).not.toEqual([]);
    });

    it("an OR of types with one alternative dropped", () => {
        const plan = runPlan([sweep(DESTROY, { type: ["Creature", "Land"] })]);
        resolveSpell(plan, [sweep(DESTROY, { type: "Creature" })]);
        expect(failures(plan)).not.toEqual([]);
    });

    it("the mana value guard removed", () => {
        const guarded = sweep(
            {
                op: "if",
                predicate: {
                    left: { manaValue: { of: { ref: "$each" } } },
                    op: "le",
                    right: { X: true },
                },
                then: [DESTROY],
            },
            { type: "Artifact" }
        );
        const plan = runPlan([guarded]);
        resolveSpell(plan, [sweep(DESTROY, { type: "Artifact" })]);
        expect(failures(plan)).not.toEqual([]);
    });

    it("a body that does nothing", () => {
        const plan = runPlan([sweep(DESTROY, { type: "Artifact" })]);
        resolveSpell(plan, [sweep(DESTROY, { subtype: "Nothing Has This" })]);
        expect(failures(plan)).not.toEqual([]);
    });
});

describe("'other' names the source only where it is a permanent (CR 113.7)", () => {
    const KNIGHT = abilityHost(
        { types: ["Creature"], subtypes: ["Knight"], power: 2, toughness: 2 },
        true
    );
    const OTHER_KNIGHTS = sweep(
        PUMP,
        { subtype: "Knight" },
        { excludeSource: true }
    );

    it("an ability's sweep spares its seeded source", () => {
        const plan = runPlan([OTHER_KNIGHTS], KNIGHT);
        expect(plan.scenario.sourcePermanentId).toBeDefined();
        resolveAbility(plan, [OTHER_KNIGHTS]);
        expect(failures(plan)).toEqual([]);
    });

    it("the same sweep without the exclusion breaks the plan", () => {
        const plan = runPlan([OTHER_KNIGHTS], KNIGHT);
        resolveAbility(plan, [sweep(PUMP, { subtype: "Knight" })]);
        expect(failures(plan)).not.toEqual([]);
    });

    it("a spell's sweep excludes nothing, so it does not run", () => {
        expect(skipReasons([OTHER_KNIGHTS])).toEqual([
            `construct "forEach" excludes its source at a site with no source permanent — the sweep would exclude nothing`,
            expect.stringContaining(`Op "pump" targets $source/$each`),
        ]);
    });

    it("a source gone by resolution does not run either (CR 608.2h)", () => {
        const gone = abilityHost({ types: ["Creature"] }, false);
        const plan = planSmokeTest([OTHER_KNIGHTS], gone);
        expect(plan.kind).toBe("skip");
    });

    it("a compiled spell whose 'other' means 'non-Zombie' stays quarantined", () => {
        // In Oketra's Name: the grammar reads "other creatures" as the source
        // exclusion, which on a spell leaves Zombies with both pumps.
        const outcome = compileCard(
            oracleCard({
                name: "In Oketra's Name",
                manaCost: "{1}{W}",
                typeLine: "Instant",
                oracleText:
                    "Zombies you control get +2/+1 until end of turn. Other creatures you control get +1/+1 until end of turn.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("quarantine");
        if (outcome.state !== "quarantine") return;
        expect(outcome.reasons.map((r) => r.detail)).toContainEqual(
            expect.stringContaining("excludes its source")
        );
    });
});

describe("what the seeded board cannot predict keeps the fail-closed skip", () => {
    const CASES: [string, EffectOp[]][] = [
        [
            "a bound set",
            [
                {
                    op: "forEach",
                    select: { set: "bound", ref: "$picked" },
                    effects: [UNTAP],
                } as unknown as EffectOp,
            ],
        ],
        [
            "a filter clause the reader does not name",
            [sweep(DESTROY, { type: "Creature", tapped: true })],
        ],
        [
            "a dynamic subtype",
            [sweep(DESTROY, { subtype: { ref: "$chosen" } })],
        ],
    ];

    it.each(CASES)("%s", (_label, effects) => {
        expect(skipReasons(effects)).toContain(UNMODELLED);
    });

    it("a body that is itself a planned sweep, which the nested walk leaves out", () => {
        expect(
            skipReasons([
                sweep(sweep(DESTROY, { type: "Artifact" }), {
                    type: "Creature",
                }),
            ])
        ).toContain(UNMODELLED);
    });

    it("a body nothing else speaks for", () => {
        // `gainLife` runs clean on its own, so without this skip the sweep would
        // reach the gate with no reason and no assertion.
        expect(
            skipReasons([
                sweep(
                    { op: "gainLife", player: "controller", amount: 1 },
                    { type: "Creature" }
                ),
            ])
        ).toContain(UNMODELLED);
    });
});

describe("a modelled selector the script cannot run withholds nothing itself", () => {
    const cardDependent = (effects: readonly EffectOp[]): string[] => {
        const plan = planSmokeTest(effects);
        return plan.kind === "skip"
            ? plan.skips
                  .filter((s) => SMOKE_SKIP_CLASS[s.code] === "card-dependent")
                  .map((s) => s.reason)
            : [];
    };

    it.each<[string, EffectOp[]]>([
        [
            "beside an Op that reads the same boards",
            [
                sweep(BOUNCE, { type: "Artifact" }),
                {
                    op: "draw",
                    player: "controller",
                    count: 1,
                } as unknown as EffectOp,
            ],
        ],
        [
            "beside a sweep observing the same outcome",
            [
                sweep(DESTROY, { type: "Artifact" }),
                sweep(DESTROY, { type: "Creature" }),
            ],
        ],
        [
            "inside a container that never runs",
            [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Pay?",
                    bind: "$paid",
                },
                {
                    op: "if",
                    predicate: { binding: "$paid" },
                    then: [sweep(DESTROY, { type: "Artifact" })],
                },
            ] as unknown as EffectOp[],
        ],
    ])("%s", (_label, effects) => {
        expect(planSmokeTest(effects).kind).toBe("skip");
        expect(cardDependent(effects)).toEqual([]);
    });

    const UNPREDICTABLE_BODIES: [string, EffectOp[]][] = [
        [
            "a body of two Ops",
            [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature" },
                    },
                    effects: [TAP, PUMP],
                } as unknown as EffectOp,
            ],
        ],
        ["a P/T read off a noncreature", [sweep(PUMP, { type: "Artifact" })]],
        [
            "damage the filler would die to",
            [
                sweep(
                    { op: "dealDamage", amount: 8, to: { ref: "$each" } },
                    { type: "Creature" }
                ),
            ],
        ],
    ];

    it.each(UNPREDICTABLE_BODIES)(
        "a body the board cannot predict names its own reason: %s",
        (_label, effects) => {
            expect(planSmokeTest(effects).kind).toBe("skip");
            expect(cardDependent(effects)).not.toEqual([]);
            expect(cardDependent(effects)).not.toContain(UNMODELLED);
        }
    );

    it("a body naming its own reason replaces the sweep's", () => {
        const reasons = cardDependent([
            sweep(
                {
                    op: "grantAbility",
                    target: { ref: "$each" },
                    ability: "flying",
                    duration: { phase: "end-of-turn" },
                },
                { type: "Creature" }
            ),
        ]);
        expect(reasons).toEqual([
            expect.stringContaining(`Op "grantAbility" targets $source/$each`),
        ]);
    });

    it("a selector it cannot seed still holds, whatever the body says", () => {
        const reasons = cardDependent([
            sweep(DESTROY, { type: "Creature", tapped: true }),
        ]);
        expect(reasons).toContain(UNMODELLED);
    });
});

describe("the Oracle gate no longer holds a plain mass effect", () => {
    it.each([
        [
            "Devastation",
            "{5}{R}{R}",
            "Sorcery",
            "Destroy all creatures and lands.",
        ],
        ["Metal Fatigue", "{2}{W}", "Instant", "Tap all artifacts."],
        [
            "Rebuild",
            "{2}{U}",
            "Instant",
            "Return all artifacts to their owners' hands.",
        ],
    ])("%s", (name, manaCost, typeLine, oracleText) => {
        const outcome = compileCard(
            oracleCard({
                name,
                manaCost,
                typeLine,
                oracleText,
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("ready");
    });
});
