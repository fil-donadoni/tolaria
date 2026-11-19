// Unit tests for the canned-scenario auto-test generator (issue #804). Covers
// the three moving parts the acceptance criteria call out: scenario
// construction, per-Op assertion derivation, and unsatisfiable-requirement
// reporting (an explicit skip with a reason, never a silent pass). The
// end-to-end sweep that RUNS the generated plans over the real catalogue lives
// in `convex/cards/__tests__/effectScriptSmoke.test.ts`.

import { describe, it, expect } from "vitest";
import type { EffectOp, GameEventType } from "../../../cards/types";
import { registerTokenDefinition } from "../../../cards";
import {
    abilityHost,
    activatedAbilitySourceOnBattlefield,
    ASSERTED_OP_KINDS,
    compiledTriggerSourceOnBattlefield,
    CASTER_ID,
    EVENT_SUBJECT_PERMANENT_ID,
    FILLER_CARD_DEFINITION,
    GRANTED_ABILITY_HOST,
    OPPONENT_ID,
    opCoverageGaps,
    planSmokeBranches,
    planSmokeTest,
    SMOKE_SKIP_CLASS,
    SMOKE_SKIP_CODES,
    SKIPPED_OP_KINDS,
    SOURCE_PERMANENT_ID,
    SPELL_HOST,
    triggeredAbilitySourceOnBattlefield,
    type Plan,
} from "../scenarioGenerator";
import { EFFECT_OP_REGISTRY } from "../../../cards/mechanicsRegistry";
import { makeInstance } from "../../../cards/__tests__/setup.helper";
import { resolveTopOfStack } from "../../state";
import { applyPendingChoiceSubmit } from "../../pendingChoiceSubmit";
import { resolveAnsweringChoices } from "../../../cards/__tests__/smokeChoices.helper";
import OP_DISPOSITION_SNAPSHOT from "./scenarioOpDisposition.json";

// The generator references FILLER_CARD_ID by id; register the ONE canonical
// definition (the catalogue sweep in `effectScriptSmoke.test.ts` registers the
// same object — `registerTokenDefinition` is idempotent for identical
// registrations, but NOT safe for two divergent literals racing on
// module-load order under the node project's `isolate: false`; see the
// docstring on `FILLER_CARD_DEFINITION`, issue #926).
registerTokenDefinition(FILLER_CARD_DEFINITION);

describe("scenario construction (issue #804)", () => {
    it("builds a two-seat state with a stocked library for a controller draw", () => {
        const plan = planSmokeTest([
            { op: "draw", player: "controller", count: 2 },
        ]);
        expect(plan.kind).toBe("run");
        if (plan.kind !== "run") return;
        const caster = plan.scenario.state.players.find(
            (p) => p.id === CASTER_ID
        )!;
        expect(caster.library.length).toBeGreaterThanOrEqual(2);
        expect(plan.scenario.targetKind).toBe("none");
        expect(plan.scenario.targets).toEqual([]);
    });

    it("spawns an opponent-controlled permanent for a permanent target slot", () => {
        const plan = planSmokeTest([{ op: "destroy", target: { target: 0 } }]);
        expect(plan.kind).toBe("run");
        if (plan.kind !== "run") return;
        expect(plan.scenario.targetKind).toBe("permanent");
        const permId = plan.scenario.targetPermanentIds[0];
        expect(permId).toBeTruthy();
        const opp = plan.scenario.state.players.find(
            (p) => p.id === OPPONENT_ID
        )!;
        expect(opp.battlefield.map((c) => c.id)).toContain(permId);
        expect(plan.scenario.targets[0]).toEqual({
            type: "permanent",
            id: permId,
        });
    });

    it("announces the opponent as the player target for a targeted-player Op", () => {
        const plan = planSmokeTest([
            { op: "loseLife", player: { target: 0 }, amount: 2 },
        ]);
        expect(plan.kind).toBe("run");
        if (plan.kind !== "run") return;
        expect(plan.scenario.targetKind).toBe("player");
        expect(plan.scenario.targets[0]).toEqual({
            type: "player",
            id: OPPONENT_ID,
        });
    });

    it("populates a count set so the count is a fixed, non-zero size", () => {
        const plan = planSmokeTest([
            {
                op: "draw",
                player: "controller",
                count: {
                    count: {
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature" },
                    },
                },
            },
        ]);
        expect(plan.kind).toBe("run");
        if (plan.kind !== "run") return;
        const caster = plan.scenario.state.players.find(
            (p) => p.id === CASTER_ID
        )!;
        // Count set seeded 3 creatures on the caster's battlefield.
        expect(caster.battlefield.length).toBe(3);
    });
});

describe("assertion derivation per Op kind (issue #804)", () => {
    it("derives a life-delta assertion for dealDamage to a player", () => {
        const plan = planSmokeTest([
            { op: "dealDamage", amount: 3, to: { player: "opponent" } },
        ]);
        expect(plan.kind).toBe("run");
        if (plan.kind !== "run") return;
        expect(plan.assertions).toHaveLength(1);
        expect(plan.assertions[0].label).toContain("dealDamage 3");
        // The assertion passes on a state with the expected delta applied…
        const post = structuredClone(plan.scenario.state);
        post.players.find((p) => p.id === OPPONENT_ID)!.life -= 3;
        expect(plan.assertions[0].check(post).ok).toBe(true);
        // …and fails on an unchanged state.
        expect(plan.assertions[0].check(plan.scenario.state).ok).toBe(false);
    });

    it("seeds floating mana and derives an empty-pool assertion for drainManaPool (CR 106.4)", () => {
        const plan = planSmokeTest([
            { op: "drainManaPool", player: "opponent" },
        ]);
        if (plan.kind !== "run") throw new Error("expected run");
        const seeded = plan.scenario.state.players.find(
            (p) => p.id === OPPONENT_ID
        )!;
        expect(Object.values(seeded.manaPool).some((n) => n > 0)).toBe(true);
        // Unchanged (still floating) → fails; emptied → passes.
        expect(plan.assertions[0].check(plan.scenario.state).ok).toBe(false);
        const post = structuredClone(plan.scenario.state);
        post.players.find((p) => p.id === OPPONENT_ID)!.manaPool = {};
        expect(plan.assertions[0].check(post).ok).toBe(true);
    });

    it("derives a hand-size assertion for draw", () => {
        const plan = planSmokeTest([
            { op: "draw", player: "controller", count: 2 },
        ]);
        if (plan.kind !== "run") throw new Error("expected run");
        const post = structuredClone(plan.scenario.state);
        const caster = post.players.find((p) => p.id === CASTER_ID)!;
        caster.hand.push(caster.library.pop()!, caster.library.pop()!);
        expect(plan.assertions[0].check(post).ok).toBe(true);
    });

    it("derives a zone-change assertion for destroy (battlefield → graveyard)", () => {
        const plan = planSmokeTest([{ op: "destroy", target: { target: 0 } }]);
        if (plan.kind !== "run") throw new Error("expected run");
        const permId = plan.scenario.targetPermanentIds[0];
        const post = structuredClone(plan.scenario.state);
        const opp = post.players.find((p) => p.id === OPPONENT_ID)!;
        const idx = opp.battlefield.findIndex((c) => c.id === permId);
        const [moved] = opp.battlefield.splice(idx, 1);
        opp.graveyard.push(moved);
        expect(plan.assertions[0].check(post).ok).toBe(true);
        // Still on the battlefield → assertion fails.
        expect(plan.assertions[0].check(plan.scenario.state).ok).toBe(false);
    });

    it("derives a zone-change assertion for exile (battlefield → exile)", () => {
        const plan = planSmokeTest([{ op: "exile", target: { target: 0 } }]);
        if (plan.kind !== "run") throw new Error("expected run");
        const permId = plan.scenario.targetPermanentIds[0];
        const post = structuredClone(plan.scenario.state);
        const opp = post.players.find((p) => p.id === OPPONENT_ID)!;
        const idx = opp.battlefield.findIndex((c) => c.id === permId);
        const [moved] = opp.battlefield.splice(idx, 1);
        opp.exile.push(moved);
        expect(plan.assertions[0].check(post).ok).toBe(true);
    });

    it("derives one assertion per Op for a flat composite (draw + loseLife)", () => {
        const plan = planSmokeTest([
            { op: "draw", player: { target: 0 }, count: 2 },
            { op: "loseLife", player: { target: 0 }, amount: 2 },
        ]);
        expect(plan.kind).toBe("run");
        if (plan.kind !== "run") return;
        expect(plan.assertions).toHaveLength(2);
    });

    it("predicts a count-driven amount from the seeded set size", () => {
        const plan = planSmokeTest([
            {
                op: "dealDamage",
                to: { player: "opponent" },
                amount: {
                    count: {
                        zone: "graveyard",
                        controller: "opponent",
                    },
                },
            },
        ]);
        expect(plan.kind).toBe("run");
        if (plan.kind !== "run") return;
        // Seeded 3 cards in the opponent's graveyard → 3 damage predicted.
        expect(plan.assertions[0].label).toContain("dealDamage 3");
    });
});

describe("unsatisfiable-requirement reporting (issue #804)", () => {
    it("skips an empty script with a reason", () => {
        const plan = planSmokeTest([]);
        expect(plan.kind).toBe("skip");
        if (plan.kind !== "skip") return;
        expect(plan.reason).toMatch(/empty/);
    });

    it("skips a script whose amount is a numeric ref (unpredictable outcome)", () => {
        const plan = planSmokeTest([
            { op: "exile", target: { target: 0 }, bind: "$c" },
            {
                op: "gainLife",
                player: { ref: "$c.controller" },
                amount: { ref: "$c.power" },
            },
        ] as EffectOp[]);
        expect(plan.kind).toBe("skip");
        if (plan.kind !== "skip") return;
        expect(plan.reason).toMatch(/ref/);
    });

    it("skips a script that mixes a player and a permanent target slot", () => {
        const plan = planSmokeTest([
            { op: "dealDamage", amount: 1, to: { target: 0 } },
            { op: "draw", player: { target: 0 }, count: 1 },
        ]);
        expect(plan.kind).toBe("skip");
        if (plan.kind !== "skip") return;
        expect(plan.reason).toMatch(/both|mix/i);
    });

    it("skips a script whose count set filters by color — the filler doesn't model color (issue #1952)", () => {
        // `countFillerId` seeds a filler card by type/subtype only
        // (`gen-count-filler-<type>-<subtype>`, no `colors`), so a count
        // filter that ALSO restricts by color (Pygmy Kavu's "black creature")
        // would silently seed a colorless filler that never matches the color
        // check — mispredicting a nonzero amount as 0 instead of skipping.
        const plan = planSmokeTest([
            {
                op: "draw",
                player: "controller",
                count: {
                    count: {
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature", color: "B" },
                    },
                },
            },
        ]);
        expect(plan.kind).toBe("skip");
        if (plan.kind !== "skip") return;
        expect(plan.reason).toMatch(/color/i);
    });

    it("skips a script with a `choice` Op — a canned scenario cannot submit picks (issue #805)", () => {
        // A `choice` Op suspends resolution for a live player decision; a
        // canned scenario answers only a discard pick from the chooser's own
        // hand, so any other pick is an explicit skip with a reason (never a
        // silent pass or a crash). Execution coverage for those choice cards
        // comes from their own suspension/resume tests.
        const plan = planSmokeTest([
            {
                op: "choice",
                kind: "choose-graveyard-card",
                player: "controller",
                zone: "graveyard",
                count: 1,
                prompt: "return a card",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "graveyard",
                to: "hand",
            },
        ] as EffectOp[]);
        expect(plan.kind).toBe("skip");
        if (plan.kind !== "skip") return;
        expect(plan.reason).toMatch(/choice|player input/i);
    });
});

describe("Op vocabulary coverage guard (issue #804)", () => {
    it("every registered Effect Op has a scenario assertor or a skip row (no silent gap)", () => {
        expect(opCoverageGaps()).toEqual([]);
    });

    it("ASSERTED_OP_KINDS and SKIPPED_OP_KINDS partition the registry (issue #4450)", () => {
        expect(
            ASSERTED_OP_KINDS.filter((op) => SKIPPED_OP_KINDS.includes(op))
        ).toEqual([]);
        expect([...ASSERTED_OP_KINDS, ...SKIPPED_OP_KINDS].sort()).toEqual(
            EFFECT_OP_REGISTRY.map((r) => r.op).sort()
        );
    });
});

type SmokeSkipRow = { code: string; reason: string };

/**
 * Issue #4450 — what the generator does with each Op ON ITS OWN: `"runs"` when
 * its analyser reads the Op's arguments (so the outcome is card-dependent and
 * the catalogue sweep decides), or the one `{ code, reason }` skip it raises
 * without reading anything past the Op name. The probe is a stub holding only
 * `op`, wrapped so any other field read is seen: an analyser that reads a field
 * is a real analyser, whatever it then does with `undefined`. So `"runs"`
 * means "card-dependent": whether a given card's script then runs or skips is
 * the catalogue sweep's verdict (`effectScriptSmoke.test.ts`), not this one's.
 */
function scenarioOpDisposition(
    name: string
): "runs" | SmokeSkipRow | SmokeSkipRow[] {
    let readAField = false;
    const stub = new Proxy({ op: name } as object, {
        get(target, key, receiver) {
            if (key !== "op" && typeof key === "string") readAField = true;
            return Reflect.get(target, key, receiver);
        },
    }) as EffectOp;
    let plan: Plan;
    try {
        plan = planSmokeTest([stub]);
    } catch (error) {
        // Only an analyser that read a field may throw on the bare stub.
        if (!readAField) throw error;
        return "runs";
    }
    if (readAField || plan.kind === "run") return "runs";
    const rows = plan.skips.map(({ code, reason }) => ({ code, reason }));
    return rows.length === 1 ? rows[0]! : rows;
}

describe("Op run/skip snapshot (issue #4450)", () => {
    it("every Op of the union runs, or skips with the committed (code, reason)", () => {
        const actual = Object.fromEntries(
            EFFECT_OP_REGISTRY.map((r) => r.op)
                .sort()
                .map((name) => [name, scenarioOpDisposition(name)])
        );
        // A change here is a reviewed change: an Op that used to run and now
        // skips (or the reverse, or a reworded reason) edits this file.
        expect(actual).toEqual(OP_DISPOSITION_SNAPSHOT);
    });
});

describe("smoke skip classes (ADR 0105 § 7.1, issue #3823)", () => {
    it("every skip code has exactly one class, and every class key is a code", () => {
        expect(Object.keys(SMOKE_SKIP_CLASS).sort()).toEqual(
            [...SMOKE_SKIP_CODES].sort()
        );
        for (const code of SMOKE_SKIP_CODES)
            expect(["op-covered", "card-dependent"]).toContain(
                SMOKE_SKIP_CLASS[code]
            );
    });

    it("a skipped script reports its NESTED skips, not only the container's", () => {
        const plan = planSmokeTest([
            {
                op: "mayPay",
                player: "controller",
                prompt: "Return it?",
                bind: "$may1",
            },
            {
                op: "if",
                predicate: { binding: "$may1" },
                then: [
                    { op: "moveZone", target: { ref: "$source" }, to: "hand" },
                ],
            },
        ] as EffectOp[]);
        expect(plan.kind).toBe("skip");
        if (plan.kind !== "skip") return;
        expect(
            plan.skips.map((s) => [s.op?.op, SMOKE_SKIP_CLASS[s.code]])
        ).toEqual([
            ["mayPay", "op-covered"],
            ["if", "op-covered"],
            ["moveZone", "card-dependent"],
        ]);
    });

    it("a comparison predicate's `op` is not walked as a nested Op", () => {
        const plan = planSmokeTest([
            {
                op: "if",
                predicate: { left: 1, op: "gt", right: 0 },
                then: [{ op: "draw", player: "controller", count: 1 }],
            },
        ] as EffectOp[]);
        expect(plan.kind).toBe("skip");
        if (plan.kind !== "skip") return;
        expect(plan.skips.map((s) => s.op?.op)).toEqual(["if"]);
    });

    it("a script that runs reports no skips at all", () => {
        const plan = planSmokeTest([
            { op: "draw", player: "controller", count: 1 },
        ] as EffectOp[]);
        expect(plan.kind).toBe("run");
    });
});

/** Resolves `effects` as an ACTIVATED ability of the seeded source — the same
 *  shape the catalogue sweep (`effectScriptSmoke.test.ts`) pushes: a synthetic
 *  host card carries the ability, and the stack item goes under the seeded
 *  source's id, which is what `$source` binds to (CR 113.7). */
function resolveOnSeededSource(
    plan: Extract<Plan, { kind: "run" }>,
    effects: EffectOp[],
    hostId: string,
    /** Snapshot the scenario's announced {X} onto the stack item, as the
     *  catalogue sweep does for an activated ability (CR 107.3a). */
    withX = false
): void {
    registerTokenDefinition({
        id: hostId,
        name: hostId,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Creature"],
        power: 1,
        toughness: 1,
        activatedAbilities: [
            {
                id: `${hostId}-ab`,
                oracleText: "smoke",
                cost: {},
                useStack: true,
                effects,
                ...(plan.scenario.targetKind === "permanent"
                    ? { targetRequirement: { type: "any", count: 1 } }
                    : {}),
            },
        ],
    });
    plan.scenario.state.stack.push({
        ...makeInstance(hostId, {
            id: plan.scenario.sourcePermanentId!,
            controllerId: CASTER_ID,
            ownerId: CASTER_ID,
            zone: "stack",
        }),
        castById: CASTER_ID,
        abilityId: `${hostId}-ab`,
        targets: plan.scenario.targets,
        ...(withX ? { chosenX: plan.scenario.chosenX } : {}),
    });
    resolveTopOfStack(plan.scenario.state);
}

function failedAssertions(plan: Extract<Plan, { kind: "run" }>): string[] {
    return plan.assertions
        .map((a) => ({ a, r: a.check(plan.scenario.state) }))
        .filter(({ r }) => !r.ok)
        .map(({ a, r }) => `${a.label}: ${r.detail ?? ""}`);
}

/** The ability host every pre-#3879 `"ability"` call site meant: an ordinary
 *  creature permanent, still on the battlefield when its ability resolves. */
const CREATURE_HOST = abilityHost(
    { types: ["Creature"], subtypes: ["Bear"], power: 2, toughness: 2 },
    true
);

describe("$source subjects — the seeded ability source (issue #3831, CR 113.7)", () => {
    const pumpSelf: EffectOp[] = [
        {
            op: "pump",
            target: { ref: "$source" },
            power: 2,
            toughness: 1,
            duration: { phase: "end-of-turn" },
        },
    ];

    it("seeds the source on the caster's battlefield, untapped and able to act", () => {
        const plan = planSmokeTest(pumpSelf, CREATURE_HOST);
        expect(plan.kind).toBe("run");
        if (plan.kind !== "run") return;
        expect(plan.scenario.sourcePermanentId).toBe(SOURCE_PERMANENT_ID);
        const source = plan.scenario.state.players
            .find((p) => p.id === CASTER_ID)!
            .battlefield.find((c) => c.id === SOURCE_PERMANENT_ID);
        expect(source).toMatchObject({
            controllerId: CASTER_ID,
            isTapped: false,
            isSummoningSick: false,
        });
    });

    it.each<[string, EffectOp[]]>([
        ["pump", pumpSelf],
        [
            "counters",
            [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { ref: "$source" },
                    count: 2,
                },
            ],
        ],
        ["regenerate", [{ op: "regenerate", target: { ref: "$source" } }]],
        [
            "grantAbility",
            [
                {
                    op: "grantAbility",
                    target: { ref: "$source" },
                    ability: "flying",
                    duration: { phase: "end-of-turn" },
                },
            ],
        ],
        [
            "tapUntap tap",
            [{ op: "tapUntap", action: "tap", target: { ref: "$source" } }],
        ],
        [
            "tapUntap untap",
            [{ op: "tapUntap", action: "untap", target: { ref: "$source" } }],
        ],
        [
            "markAssignsNoCombatDamage",
            // Its assertor reads a GAME-scoped list (`sourcePreventionShields`)
            // rather than a field on the instance — the one subject-routed Op
            // whose evidence is not an instance read.
            [
                {
                    op: "markAssignsNoCombatDamage",
                    target: { ref: "$source" },
                },
            ],
        ],
        [
            "skipNextUntap",
            [{ op: "skipNextUntap", target: { ref: "$source" } }],
        ],
    ])(
        "a $source %s executes through resolution and its declared outcome holds",
        (name, effects) => {
            const plan = planSmokeTest(effects, CREATURE_HOST);
            expect(plan.kind).toBe("run");
            if (plan.kind !== "run") return;
            expect(plan.assertions.length).toBeGreaterThan(0);
            // The assertions read the seeded source — unresolved, they fail,
            // so a green below is the Op's outcome, not a vacuous check.
            expect(failedAssertions(plan)).not.toEqual([]);
            resolveOnSeededSource(
                plan,
                effects,
                `gen-3831-${name.replace(" ", "-")}`
            );
            expect(failedAssertions(plan)).toEqual([]);
        }
    );

    // CR 707.2 — "{X}, {T}: This land becomes a copy of target nontoken
    // artifact you control with mana value X." (The Mycosynth Gardens): the
    // source is seeded as the host's own kind, the slot as the filler, so the
    // copy is observable in both directions.
    const LAND_HOST = abilityHost(
        { types: ["Land"], subtypes: ["Sphere"] },
        true,
        true
    );
    it.each<[string, EffectOp]>([
        [
            "source-becomes-target",
            {
                op: "becomeCopy",
                target: { ref: "$source" },
                source: { target: 0 },
            },
        ],
        [
            "target-becomes-source",
            {
                op: "becomeCopy",
                target: { target: 0 },
                source: { ref: "$source" },
            },
        ],
    ])(
        "a becomeCopy between $source and an announced slot (%s) executes through resolution and its declared outcome holds",
        (name, op) => {
            const plan = planSmokeTest([op], LAND_HOST);
            if (plan.kind !== "run") throw new Error(plan.reason);
            expect(plan.assertions.length).toBe(1);
            expect(failedAssertions(plan)).not.toEqual([]);
            resolveOnSeededSource(plan, [op], `gen-7509-${name}`);
            expect(failedAssertions(plan)).toEqual([]);
        }
    );

    it.each<[string, EffectOp, ReturnType<typeof abilityHost>, string[]]>([
        [
            "two announced slots (the same filler on both sides)",
            { op: "becomeCopy", target: { target: 0 }, source: { target: 1 } },
            LAND_HOST,
            ["op-own-tests"],
        ],
        [
            "a timed copy (CR 611.2a)",
            {
                op: "becomeCopy",
                target: { ref: "$source" },
                source: { target: 0 },
                duration: { phase: "end-of-turn" },
            },
            LAND_HOST,
            ["op-own-tests", "source-or-each-subject"],
        ],
        [
            "an except clause (CR 707.9)",
            {
                op: "becomeCopy",
                target: { ref: "$source" },
                source: { target: 0 },
                except: { additionalTypes: ["Artifact"] },
            },
            LAND_HOST,
            ["op-own-tests", "source-or-each-subject"],
        ],
        [
            "a spell-site $source",
            {
                op: "becomeCopy",
                target: { ref: "$source" },
                source: { target: 0 },
            },
            SPELL_HOST,
            ["op-own-tests", "source-or-each-subject"],
        ],
    ])("a becomeCopy with %s keeps the Op's skip", (_name, op, host, codes) => {
        const plan = planSmokeTest([op], host);
        if (plan.kind !== "skip") throw new Error("expected a skip");
        expect(plan.skips.map((s) => s.code)).toEqual(codes);
    });

    it("seeds the source TAPPED when the script untaps it, so the untap is observable", () => {
        const plan = planSmokeTest(
            [{ op: "tapUntap", action: "untap", target: { ref: "$source" } }],
            CREATURE_HOST
        );
        if (plan.kind !== "run") throw new Error(plan.reason);
        const source = plan.scenario.state.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === SOURCE_PERMANENT_ID);
        expect(source?.isTapped).toBe(true);
    });

    it("a spell-site $source is not seeded — the default site fails closed", () => {
        for (const plan of [
            planSmokeTest(pumpSelf),
            planSmokeTest(pumpSelf, SPELL_HOST),
        ]) {
            expect(plan.kind).toBe("skip");
            if (plan.kind !== "skip") continue;
            expect(plan.skips.map((s) => s.code)).toEqual([
                "source-or-each-subject",
            ]);
        }
    });

    it("a $each subject stays a card-dependent skip at an ability site", () => {
        const plan = planSmokeTest(
            [{ ...pumpSelf[0], target: { ref: "$each" } } as EffectOp],
            CREATURE_HOST
        );
        expect(plan.kind).toBe("skip");
        if (plan.kind !== "skip") return;
        expect(plan.skips.map((s) => s.code)).toEqual([
            "source-or-each-subject",
        ]);
    });

    it("a script that both taps and untaps its source is skipped, not mis-asserted", () => {
        const plan = planSmokeTest(
            [
                { op: "tapUntap", action: "tap", target: { ref: "$source" } },
                { op: "tapUntap", action: "untap", target: { ref: "$source" } },
            ],
            CREATURE_HOST
        );
        expect(plan.kind).toBe("skip");
        if (plan.kind !== "skip") return;
        expect(plan.skips.map((s) => s.code)).toEqual([
            "source-or-each-subject",
        ]);
    });

    it("an op-covered Op still does not hide a $source subject it cannot run", () => {
        // `preventDamage` registers a dormant shield (op-covered) — nothing is
        // executed against the seeded source, so its `$source` subject stays
        // card-dependent (ADR 0105 § 7.1) even at an ability site.
        const plan = planSmokeTest(
            [
                {
                    op: "preventDamage",
                    mode: "next-n",
                    to: { ref: "$source" },
                    amount: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
            CREATURE_HOST
        );
        expect(plan.kind).toBe("skip");
        if (plan.kind !== "skip") return;
        expect(
            plan.skips.map((s) => [s.code, SMOKE_SKIP_CLASS[s.code]])
        ).toContainEqual(["source-or-each-subject", "card-dependent"]);
    });

    it("a choice's literal { min, max } count range is op-covered, not a runtime amount", () => {
        const choice = (count: unknown): EffectOp[] => [
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                filter: { type: "Land" },
                count,
                prompt: "Search for up to two land cards",
            } as EffectOp,
        ];
        const literal = planSmokeTest(choice({ min: 0, max: 2 }));
        expect(literal.kind).toBe("skip");
        if (literal.kind !== "skip") return;
        expect(
            literal.skips.map((s) => SMOKE_SKIP_CLASS[s.code])
        ).not.toContain("card-dependent");

        // A computed ceiling is still card-dependent, under its own reason.
        const computed = planSmokeTest(choice({ min: 0, max: { X: true } }));
        expect(computed.kind).toBe("skip");
        if (computed.kind !== "skip") return;
        expect(computed.skips.map((s) => SMOKE_SKIP_CLASS[s.code])).toContain(
            "card-dependent"
        );
    });

    it("a delayedTrigger's $source capture is bookkeeping, not a card-dependent subject (CR 603.7)", () => {
        const plan = planSmokeTest(
            [
                {
                    op: "delayedTrigger",
                    timing: "next-cleanup-step",
                    oracleText: "Return this land to its owner's hand.",
                    capture: { $self: { ref: "$source" } },
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$self" },
                            to: "hand",
                        },
                    ],
                } as EffectOp,
            ],
            CREATURE_HOST
        );
        expect(plan.kind).toBe("skip");
        if (plan.kind !== "skip") return;
        const codes = plan.skips.map((s) => s.code);
        expect(codes).toContain("later-outcome");
        // the payload walk still reports the body's own card-dependent clause
        expect(codes).toContain("unmodelled-object-or-zone");
        expect(codes).not.toContain("source-or-each-subject");
        expect(codes).not.toContain("runtime-amount");
    });
});

describe("the seeded $source is the HOST card, where it really is (issue #3879)", () => {
    const ARTIFACT_HOST = abilityHost({ types: ["Artifact"] }, true);
    const CLASS_HOST = abilityHost(
        { types: ["Enchantment"], subtypes: ["Class"] },
        true
    );
    const tapSelf: EffectOp[] = [
        { op: "tapUntap", action: "tap", target: { ref: "$source" } },
    ];

    it("seeds a source whose types are the host's, not the filler creature's", () => {
        for (const [host, types, subtypes] of [
            [ARTIFACT_HOST, ["Artifact"], []],
            [CLASS_HOST, ["Enchantment"], ["Class"]],
        ] as const) {
            const plan = planSmokeTest(tapSelf, host);
            if (plan.kind !== "run") throw new Error(plan.reason);
            const source = plan.scenario.state.players
                .find((p) => p.id === CASTER_ID)!
                .battlefield.find((c) => c.id === SOURCE_PERMANENT_ID)!;
            expect(source.types).toEqual(types);
            expect(source.subtypes).toEqual(subtypes);
        }
    });

    it.each(["exileOnDeath", "lockDamage", "preventRegeneration", "pump"])(
        "%s on a non-creature $source is a card-dependent skip, not a green run",
        (op) => {
            const effects = [
                {
                    op,
                    target: { ref: "$source" },
                    // `pump` is the one member whose primitive does NOT gate on
                    // Creature: its ASSERTION is a power/toughness read, and
                    // only a creature card has those (CR 208.1).
                    ...(op === "pump"
                        ? {
                              power: 1,
                              toughness: 1,
                              duration: { phase: "end-of-turn" },
                          }
                        : {}),
                },
            ] as unknown as EffectOp[];
            // The same script on a CREATURE host runs — so the skip below is
            // about the host's kind, not about the Op.
            expect(planSmokeTest(effects, CREATURE_HOST).kind).toBe("run");
            const plan = planSmokeTest(effects, ARTIFACT_HOST);
            expect(plan.kind).toBe("skip");
            if (plan.kind !== "skip") return;
            expect(
                plan.skips.map((s) => [s.code, SMOKE_SKIP_CLASS[s.code]])
            ).toContainEqual(["source-or-each-subject", "card-dependent"]);
        }
    );

    it("a source that is gone at resolution is unmodelled, exactly like a spell site", () => {
        // CR 603.10 / 608.2h — the ability resolves with its source already
        // out of the battlefield, so `$source` binds to nothing.
        const departed = abilityHost(
            { types: ["Creature"], power: 2, toughness: 2 },
            false
        );
        const plan = planSmokeTest(tapSelf, departed);
        expect(plan.kind).toBe("skip");
        if (plan.kind !== "skip") return;
        expect(plan.skips.map((s) => s.code)).toEqual([
            "source-or-each-subject",
        ]);
        // ...and the SAME script with the source still there runs.
        expect(planSmokeTest(tapSelf, CREATURE_HOST).kind).toBe("run");
    });

    it("seeds the host's printed power and toughness, not the filler's", () => {
        const plan = planSmokeTest(
            tapSelf,
            abilityHost({ types: ["Creature"], power: 4, toughness: 7 }, true)
        );
        if (plan.kind !== "run") throw new Error(plan.reason);
        const source = plan.scenario.state.players
            .find((p) => p.id === CASTER_ID)!
            .battlefield.find((c) => c.id === SOURCE_PERMANENT_ID)!;
        expect([source.power, source.toughness]).toEqual([4, 7]);
    });

    it("reads the zone an ability functions in off its own flags (CR 113.6b)", () => {
        // Activated: the two activation-zone flags the engine dispatches on.
        expect(activatedAbilitySourceOnBattlefield({})).toBe(true);
        expect(
            activatedAbilitySourceOnBattlefield({ activateFromGraveyard: true })
        ).toBe(false);
        expect(
            activatedAbilitySourceOnBattlefield({ activateFromHand: true })
        ).toBe(false);
        // Triggered: the hand-authored zone flags. This is the reader the whole
        // catalogue sweep goes through, so it is pinned here too.
        expect(triggeredAbilitySourceOnBattlefield({})).toBe(true);
        for (const flag of [
            { zone: "graveyard" } as const,
            { functionsFromStack: true } as const,
            { functionsFromOwnDiscard: true } as const,
        ])
            expect(triggeredAbilitySourceOnBattlefield(flag)).toBe(false);
    });

    it("a compiled head keyed on the source's OWN departure says it is gone (CR 603.10)", () => {
        // `self` is the source dying; `host` is an Aura's "whenever enchanted
        // creature dies" — the Aura follows its host to the graveyard by the
        // attachment SBA (CR 704.5m) before the trigger resolves.
        for (const scope of ["self", "host"] as const)
            expect(
                compiledTriggerSourceOnBattlefield({ kind: "died", scope })
            ).toBe(false);
        for (const scope of ["any", "yours", "another-yours"] as const)
            expect(
                compiledTriggerSourceOnBattlefield({ kind: "died", scope })
            ).toBe(true);
        expect(
            compiledTriggerSourceOnBattlefield({
                kind: "entered",
                scope: "self",
            })
        ).toBe(true);
        expect(compiledTriggerSourceOnBattlefield({ kind: "attacks" })).toBe(
            true
        );
    });

    it("counts the seeded source in a controller battlefield count it really appears in", () => {
        // The count filler seeds COUNT_SET_SIZE permanents on the caster's
        // battlefield and the source is a fourth: the script reads 4, so the
        // prediction must be 4 (issue #3879 — it used to be 3, a false red).
        const effects: EffectOp[] = [
            { op: "tapUntap", action: "tap", target: { ref: "$source" } },
            {
                op: "gainLife",
                player: "controller",
                amount: {
                    count: { zone: "battlefield", controller: "controller" },
                },
            },
        ];
        const plan = planSmokeTest(effects, CREATURE_HOST);
        if (plan.kind !== "run") throw new Error(plan.reason);
        expect(failedAssertions(plan)).not.toEqual([]);
        resolveOnSeededSource(plan, effects, "gen-3879-count");
        expect(failedAssertions(plan)).toEqual([]);
    });

    it("skips a count filter the seeded source's kind cannot decide", () => {
        const plan = planSmokeTest(
            [
                { op: "tapUntap", action: "tap", target: { ref: "$source" } },
                {
                    op: "gainLife",
                    player: "controller",
                    amount: {
                        count: {
                            zone: "battlefield",
                            controller: "controller",
                            filter: { supertype: "Legendary" },
                        },
                    },
                },
            ],
            CREATURE_HOST
        );
        expect(plan.kind).toBe("skip");
        if (plan.kind !== "skip") return;
        expect(plan.skips.map((s) => s.code)).toEqual(["runtime-amount"]);
    });
});

/** Resolves `effects` as a SPELL with the plan's announced {X} — the shape the
 *  catalogue sweep pushes. `withX: false` drops the announcement, the stack
 *  item a cast-less push would leave without the scenario's `chosenX`. */
function resolveAsSpell(
    plan: Extract<Plan, { kind: "run" }>,
    effects: EffectOp[],
    id: string,
    withX: boolean
): void {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        effects,
        targetRequirement: { type: "player", count: 1 },
    });
    plan.scenario.state.stack.push({
        ...makeInstance(id, {
            controllerId: CASTER_ID,
            ownerId: CASTER_ID,
            zone: "hand",
        }),
        castById: CASTER_ID,
        targets: plan.scenario.targets,
        ...(withX ? { chosenX: plan.scenario.chosenX } : {}),
    });
    resolveTopOfStack(plan.scenario.state);
}

describe("chosen-cost X amounts (CR 107.3a, issue #4022)", () => {
    // Death Grasp's shape: "deals X damage to any target. You gain X life."
    const effects: EffectOp[] = [
        { op: "dealDamage", amount: { X: true }, to: { target: 0 } },
        { op: "gainLife", player: "controller", amount: { X: true } },
    ];

    it("announces an X and predicts every X amount from it", () => {
        const plan = planSmokeTest(effects);
        expect(plan.kind).toBe("run");
        if (plan.kind !== "run") return;
        expect(plan.scenario.chosenX).toBe(4);
        expect(plan.assertions.map((a) => a.label)).toEqual([
            expect.stringContaining("dealDamage 4"),
            expect.stringContaining("gainLife 4"),
        ]);
    });

    it("an activated ability announces its X too", () => {
        const host = abilityHost({ types: ["Artifact"] }, true, true);
        const plan = planSmokeTest(
            [{ op: "gainLife", player: "controller", amount: { X: true } }],
            host
        );
        expect(plan.kind).toBe("run");
        if (plan.kind !== "run") return;
        expect(plan.scenario.chosenX).toBe(4);
    });

    it("a triggered or granted ability's X stays a card-dependent skip", () => {
        const script: EffectOp[] = [
            { op: "gainLife", player: "controller", amount: { X: true } },
        ];
        for (const host of [
            abilityHost({ types: ["Creature"] }, true),
            GRANTED_ABILITY_HOST,
        ]) {
            const plan = planSmokeTest(script, host);
            expect(plan.kind).toBe("skip");
            if (plan.kind !== "skip") continue;
            expect(plan.skips.map((s) => s.code)).toEqual(["unannounced-x"]);
            expect(SMOKE_SKIP_CLASS["unannounced-x"]).toBe("card-dependent");
        }
    });

    it("an op-covered Op's X amount stays card-dependent — it never runs", () => {
        const plan = planSmokeTest([
            { op: "mill", player: { target: 0 }, count: { X: true } },
        ] as EffectOp[]);
        expect(plan.kind).toBe("skip");
        if (plan.kind !== "skip") return;
        expect(
            plan.skips.some(
                (s) => SMOKE_SKIP_CLASS[s.code] === "card-dependent"
            )
        ).toBe(true);
    });

    it("the announced X resolves to the predicted outcome", () => {
        const plan = planSmokeTest(effects);
        if (plan.kind !== "run") throw new Error("expected a run plan");
        resolveAsSpell(plan, effects, "smoke-x-announced", true);
        expect(failedAssertions(plan)).toEqual([]);
    });

    it("a stack item without the announcement fails the assertions", () => {
        const plan = planSmokeTest(effects);
        if (plan.kind !== "run") throw new Error("expected a run plan");
        resolveAsSpell(plan, effects, "smoke-x-unannounced", false);
        expect(failedAssertions(plan)).toHaveLength(2);
    });

    it("a script with no X announces none", () => {
        const plan = planSmokeTest([
            { op: "gainLife", player: "controller", amount: 3 },
        ]);
        if (plan.kind !== "run") throw new Error("expected a run plan");
        expect(plan.scenario.chosenX).toBeUndefined();
    });
});

describe("chosen-cost X counter counts (CR 107.3a, issue #5267)", () => {
    // Blast Zone's shape: "{X}{X}, {T}: Put X charge counters on this land."
    const xCounters: EffectOp[] = [
        {
            op: "counters",
            action: "add",
            counter: "charge",
            target: { ref: "$source" },
            count: { X: true },
        },
    ];
    const LAND_HOST = abilityHost({ types: ["Land"] }, true, true);

    it("an activated ability's X counter count is predicted from the announced X", () => {
        const plan = planSmokeTest(xCounters, LAND_HOST);
        expect(plan.kind).toBe("run");
        if (plan.kind !== "run") return;
        expect(plan.scenario.chosenX).toBe(4);
        expect(plan.assertions.map((a) => a.label)).toEqual([
            expect.stringContaining("add 4 charge counter(s)"),
        ]);
    });

    it("the announced X resolves to the predicted counter tally", () => {
        const plan = planSmokeTest(xCounters, LAND_HOST);
        if (plan.kind !== "run") throw new Error("expected a run plan");
        resolveOnSeededSource(plan, xCounters, "smoke-x-counters", true);
        expect(failedAssertions(plan)).toEqual([]);
    });

    it("a stack item without the announcement fails the assertion", () => {
        const plan = planSmokeTest(xCounters, LAND_HOST);
        if (plan.kind !== "run") throw new Error("expected a run plan");
        resolveOnSeededSource(plan, xCounters, "smoke-x-counters-no-x", false);
        expect(failedAssertions(plan)).toHaveLength(1);
    });

    it("a triggered ability's X counter count stays a card-dependent skip", () => {
        const plan = planSmokeTest(
            xCounters,
            abilityHost({ types: ["Land"] }, true)
        );
        expect(plan.kind).toBe("skip");
        if (plan.kind !== "skip") return;
        expect(plan.skips.map((s) => s.code)).toEqual(["unannounced-x"]);
    });
});

describe("random discard (CR 701.9b, issue #5943)", () => {
    // Mind Twist's shape: "Target player discards X cards at random."
    const twist: EffectOp[] = [
        { op: "discardAtRandom", player: { target: 0 }, count: { X: true } },
    ];
    const handOf = (plan: Extract<Plan, { kind: "run" }>, id: string) =>
        plan.scenario.state.players.find((p) => p.id === id)!.hand;

    it("seeds the discarding player's hand and sizes an announced X", () => {
        const plan = planSmokeTest(twist);
        expect(plan.kind).toBe("run");
        if (plan.kind !== "run") return;
        expect(plan.scenario.chosenX).toBe(4);
        expect(handOf(plan, OPPONENT_ID)).toHaveLength(7);
        expect(handOf(plan, CASTER_ID)).toHaveLength(0);
        expect(plan.assertions.map((a) => a.label)).toEqual([
            expect.stringContaining("hand 7→3"),
        ]);
    });

    it("the discard resolves to the predicted hand and graveyard (CR 701.9a)", () => {
        const plan = planSmokeTest(twist);
        if (plan.kind !== "run") throw new Error("expected a run plan");
        resolveAsSpell(plan, twist, "smoke-discard-random", true);
        expect(failedAssertions(plan)).toEqual([]);
    });

    it("a discard of the wrong count fails the assertion", () => {
        const plan = planSmokeTest(twist);
        if (plan.kind !== "run") throw new Error("expected a run plan");
        resolveAsSpell(plan, twist, "smoke-discard-random-no-x", false);
        expect(failedAssertions(plan)).toHaveLength(1);
    });

    it("an activated ability's announced X runs too", () => {
        const plan = planSmokeTest(
            twist,
            abilityHost({ types: ["Creature"] }, true, true)
        );
        expect(plan.kind).toBe("run");
    });

    it("discards in two branches of one if are not two discards", () => {
        const plan = planSmokeTest([
            {
                op: "if",
                predicate: { left: 1, op: "gt", right: 0 },
                then: [{ op: "discardAtRandom", player: "opponent", count: 1 }],
                else: [{ op: "discardAtRandom", player: "opponent", count: 2 }],
            },
        ] as EffectOp[]);
        expect(plan.kind).toBe("skip");
        if (plan.kind !== "skip") return;
        expect(plan.skips.map((s) => SMOKE_SKIP_CLASS[s.code])).not.toContain(
            "card-dependent"
        );
    });

    it("a hand another Op of the script also changes is a card-dependent skip", () => {
        for (const script of [
            [
                { op: "draw", player: "controller", count: 2 },
                { op: "discardAtRandom", player: "controller", count: 1 },
            ],
            [
                { op: "discardAtRandom", player: "opponent", count: 1 },
                { op: "discardAtRandom", player: { target: 0 }, count: 1 },
            ],
            [
                { op: "armGraveyardRedirect", player: "opponent" },
                { op: "discardAtRandom", player: "opponent", count: 1 },
            ],
        ] as EffectOp[][]) {
            const plan = planSmokeTest(script);
            expect(plan.kind).toBe("skip");
            if (plan.kind !== "skip") continue;
            expect(plan.skips.map((s) => s.code)).toEqual(["runtime-amount"]);
        }
    });
});

describe("hand count sets (CR 402.3, issue #4206)", () => {
    // Inner Fire's shape: "Add {R} for each card in your hand."
    const innerFire: EffectOp[] = [
        {
            op: "addMana",
            mana: { R: { count: { zone: "hand", controller: "controller" } } },
        },
    ];
    // Gerrard Capashen's shape: "you gain 1 life for each card in target
    // opponent's hand."
    const opponentsHand: EffectOp[] = [
        {
            op: "gainLife",
            player: "controller",
            amount: { count: { zone: "hand", controller: { target: 0 } } },
        },
    ];
    const handOf = (plan: Extract<Plan, { kind: "run" }>, id: string) =>
        plan.scenario.state.players.find((p) => p.id === id)!.hand;

    it("banks the count in the counted hand and predicts its size", () => {
        const plan = planSmokeTest(innerFire);
        if (plan.kind !== "run") throw new Error(plan.reason);
        expect(handOf(plan, CASTER_ID)).toHaveLength(3);
        expect(handOf(plan, OPPONENT_ID)).toHaveLength(0);
        expect(failedAssertions(plan)).not.toEqual([]);
        resolveAsSpell(plan, innerFire, "smoke-hand-count", true);
        expect(failedAssertions(plan)).toEqual([]);
    });

    it("announces a targeted player's hand as the opponent's", () => {
        const plan = planSmokeTest(opponentsHand);
        if (plan.kind !== "run") throw new Error(plan.reason);
        expect(handOf(plan, OPPONENT_ID)).toHaveLength(3);
        resolveAsSpell(plan, opponentsHand, "smoke-hand-count-target", true);
        expect(failedAssertions(plan)).toEqual([]);
    });

    it("skips a hand another part of the script changes", () => {
        for (const touch of [
            { op: "draw", player: "controller", count: 1 },
            { op: "discardAtRandom", player: "controller", count: 1 },
            ...innerFire,
        ] as EffectOp[]) {
            const plan = planSmokeTest([touch, ...innerFire]);
            expect(plan.kind).toBe("skip");
            if (plan.kind !== "skip") continue;
            expect(plan.skips).toContainEqual(
                expect.objectContaining({
                    code: "runtime-amount",
                    reason: expect.stringContaining("counts a HAND"),
                })
            );
        }
    });
});

describe("sacrifice this permanent — if you do (CR 701.21a, issue #6423)", () => {
    // Aang's Iceberg's shape: "Sacrifice this enchantment. If you do, <body>",
    // with a body the sweep can assert.
    const gated = (
        predicate: Record<string, unknown> = {
            boundMatchesFilter: { ref: "$sacrificed1" },
            filter: {},
        },
        rest: Record<string, unknown> = {}
    ): EffectOp[] =>
        [
            {
                op: "sacrifice",
                target: { ref: "$source" },
                bind: "$sacrificed1",
            },
            {
                op: "if",
                predicate,
                then: [{ op: "gainLife", player: "controller", amount: 3 }],
                ...rest,
            },
        ] as EffectOp[];
    const ENCHANTMENT_HOST = abilityHost({ types: ["Enchantment"] }, true);
    const SACRIFICE_SKIP = `Op "sacrifice" consumes a choice binding — covered by the card's own suspension/resume tests`;

    it("plans a run asserting the sacrifice and the gated body", () => {
        const plan = planSmokeTest(gated(), ENCHANTMENT_HOST);
        expect(plan.kind).toBe("run");
        if (plan.kind !== "run") return;
        expect(plan.assertions.map((a) => a.label)).toEqual([
            expect.stringContaining("sacrifice moves source permanent"),
            expect.stringContaining("gainLife 3"),
        ]);
    });

    it("the source goes to the graveyard and the body resolves", () => {
        const script = gated();
        const plan = planSmokeTest(script, ENCHANTMENT_HOST);
        if (plan.kind !== "run") throw new Error("expected a run plan");
        resolveOnSeededSource(plan, script, "smoke-sacrifice-source");
        expect(failedAssertions(plan)).toEqual([]);
    });

    it("a source already gone fails both assertions", () => {
        const script = gated();
        const plan = planSmokeTest(script, ENCHANTMENT_HOST);
        if (plan.kind !== "run") throw new Error("expected a run plan");
        const caster = plan.scenario.state.players.find(
            (p) => p.id === CASTER_ID
        )!;
        caster.battlefield = caster.battlefield.filter(
            (c) => c.id !== SOURCE_PERMANENT_ID
        );
        resolveOnSeededSource(plan, script, "smoke-sacrifice-source-gone");
        expect(failedAssertions(plan)).toHaveLength(2);
    });

    it("a script that runs no gated body still asserts the sacrifice", () => {
        const plan = planSmokeTest(
            [
                { op: "sacrifice", target: { ref: "$source" } },
                { op: "draw", player: "controller", count: 1 },
            ] as EffectOp[],
            ENCHANTMENT_HOST
        );
        expect(plan.kind).toBe("run");
    });

    it("every shape the canned scenario cannot prove stays a card-dependent skip", () => {
        const cases: [EffectOp[], ReturnType<typeof abilityHost>][] = [
            // No seeded source: a spell, or a source gone at resolution.
            [gated(), SPELL_HOST],
            [gated(), abilityHost({ types: ["Enchantment"] }, false)],
            // A later read of the sacrificed source.
            [
                [
                    ...gated(),
                    {
                        op: "counters",
                        action: "add",
                        counter: "+1/+1",
                        count: 1,
                        target: { ref: "$source" },
                    },
                ] as EffectOp[],
                ENCHANTMENT_HOST,
            ],
        ];
        for (const [script, host] of cases) {
            const plan = planSmokeTest(script, host);
            expect(plan.kind).toBe("skip");
            if (plan.kind !== "skip") continue;
            expect(plan.skips.map((s) => s.reason)).toContain(SACRIFICE_SKIP);
        }
        // A predicate that asks more than "did it happen", or an else branch,
        // stays the binding read the generator does not model.
        for (const script of [
            gated({
                boundMatchesFilter: { ref: "$sacrificed1" },
                filter: { types: ["Creature"] },
            }),
            gated(undefined, {
                else: [{ op: "draw", player: "controller", count: 1 }],
            }),
        ]) {
            const plan = planSmokeTest(script, ENCHANTMENT_HOST);
            expect(plan.kind).toBe("skip");
            if (plan.kind !== "skip") continue;
            expect(plan.skips.map((s) => s.reason)).toContain(
                `Op "if" reads ref "$sacrificed1" — depends on a runtime binding`
            );
        }
    });
});

describe("$source counter-count amounts (CR 608.2h, issue #5265)", () => {
    // Ratchet Bomb's shape, reduced to an amount the sweep can assert: the
    // ability reads the number of charge counters on its own source.
    const readsCharge: EffectOp[] = [
        {
            op: "gainLife",
            player: "controller",
            amount: { counters: { of: { ref: "$source" }, type: "charge" } },
        },
    ];
    const ARTIFACT_HOST = abilityHost({ types: ["Artifact"] }, true, true);

    function seededSource(plan: Extract<Plan, { kind: "run" }>) {
        return plan.scenario.state.players
            .find((p) => p.id === CASTER_ID)!
            .battlefield.find((c) => c.id === SOURCE_PERMANENT_ID);
    }

    it("seeds the read counters on the source and predicts that count", () => {
        const plan = planSmokeTest(readsCharge, ARTIFACT_HOST);
        expect(plan.kind).toBe("run");
        if (plan.kind !== "run") return;
        expect(plan.scenario.sourceCounters).toEqual({ charge: 6 });
        expect(seededSource(plan)?.counters).toEqual({ charge: 6 });
        expect(plan.assertions.map((a) => a.label)).toEqual([
            expect.stringContaining("gainLife 6"),
        ]);
    });

    it("the seeded count resolves to the predicted outcome", () => {
        const plan = planSmokeTest(readsCharge, ARTIFACT_HOST);
        if (plan.kind !== "run") throw new Error("expected a run plan");
        resolveOnSeededSource(plan, readsCharge, "smoke-counters-seeded");
        expect(failedAssertions(plan)).toEqual([]);
    });

    it("a source without the seeded counters fails the assertion", () => {
        const plan = planSmokeTest(readsCharge, ARTIFACT_HOST);
        if (plan.kind !== "run") throw new Error("expected a run plan");
        const source = seededSource(plan)!;
        source.counters = {};
        resolveOnSeededSource(plan, readsCharge, "smoke-counters-unseeded");
        expect(failedAssertions(plan)).toHaveLength(1);
    });

    it("a count read off a spell, a departed source, a target or $each stays a card-dependent skip", () => {
        const of = (subject: unknown): EffectOp[] =>
            [
                {
                    op: "gainLife",
                    player: "controller",
                    amount: { counters: { of: subject, type: "charge" } },
                },
            ] as EffectOp[];
        for (const [script, host] of [
            [readsCharge, SPELL_HOST],
            [readsCharge, abilityHost({ types: ["Artifact"] }, false, true)],
            [of({ target: 0 }), ARTIFACT_HOST],
            [of({ ref: "$each" }), ARTIFACT_HOST],
        ] as const) {
            const plan = planSmokeTest(script, host);
            expect(plan.kind).toBe("skip");
            if (plan.kind !== "skip") continue;
            expect(plan.skips.map((s) => s.reason)).toContain(
                `amount reads a permanent's "charge" counter count — the canned generator does not pre-seed counters`
            );
        }
    });

    it("a count the same script changes on $source is not predicted", () => {
        const plan = planSmokeTest(
            [
                {
                    op: "counters",
                    action: "add",
                    counter: "charge",
                    target: { ref: "$source" },
                    count: 1,
                },
                ...readsCharge,
            ],
            ARTIFACT_HOST
        );
        expect(plan.kind).toBe("skip");
        if (plan.kind !== "skip") return;
        expect(plan.skips.map((s) => s.code)).toEqual(["runtime-amount"]);
    });

    it("a script reading no counter count seeds none", () => {
        const plan = planSmokeTest(
            [
                {
                    op: "counters",
                    action: "add",
                    counter: "charge",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
            ARTIFACT_HOST
        );
        if (plan.kind !== "run") throw new Error("expected a run plan");
        expect(plan.scenario.sourceCounters).toBeUndefined();
        expect(seededSource(plan)?.counters).toBeUndefined();
    });
});

describe("if-branch scenario-ization (issue #1707, CR 702.33)", () => {
    const kickedBurn: EffectOp[] = [
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [{ op: "dealDamage", to: { player: "opponent" }, amount: 5 }],
            else: [{ op: "dealDamage", to: { player: "opponent" }, amount: 2 }],
        },
    ];

    it("plans one run per branch, the kicked one announcing its payment", () => {
        const { plans, skipped } = planSmokeBranches(kickedBurn);
        expect(skipped).toEqual([]);
        const runs = plans.filter((p) => p.kind === "run");
        expect(runs).toHaveLength(2);
        const kicked = runs.filter(
            (p) => p.kind === "run" && p.scenario.kickerPayments !== undefined
        );
        expect(kicked).toHaveLength(1);
        expect(
            kicked[0]!.kind === "run" && kicked[0]!.scenario.kickerPayments
        ).toEqual({ kicker: 1 });
    });

    it("asserts the branch the interpreter really takes (resolved end to end)", () => {
        const { plans } = planSmokeBranches(kickedBurn);
        const lifeLost: number[] = [];
        for (const [i, plan] of plans.entries()) {
            if (plan.kind !== "run") throw new Error("expected a run plan");
            const id = `branch-burn-${i}`;
            registerTokenDefinition({
                id,
                name: id,
                rarity: "common",
                manaCost: { R: 1 },
                types: ["Sorcery"],
                effects: kickedBurn,
            });
            const state = plan.scenario.state;
            const before = state.players.find(
                (p) => p.id === OPPONENT_ID
            )!.life;
            state.stack.push({
                ...makeInstance(id, {
                    controllerId: CASTER_ID,
                    ownerId: CASTER_ID,
                    zone: "hand",
                }),
                castById: CASTER_ID,
                targets: plan.scenario.targets,
                ...(plan.scenario.kickerPayments
                    ? { kickerPayments: { ...plan.scenario.kickerPayments } }
                    : {}),
            });
            resolveTopOfStack(state);
            for (const a of plan.assertions)
                expect(a.check(state).ok, a.label).toBe(true);
            lifeLost.push(
                before - state.players.find((p) => p.id === OPPONENT_ID)!.life
            );
        }
        expect(lifeLost.sort()).toEqual([2, 5]);
    });

    it("keeps a count predicate a skip: the final scenario does not seed its set", () => {
        const { plans } = planSmokeBranches([
            {
                op: "if",
                predicate: {
                    left: {
                        count: { zone: "graveyard", controller: "controller" },
                    },
                    op: "ge",
                    right: 1,
                },
                then: [{ op: "gainLife", player: "controller", amount: 3 }],
                else: [{ op: "gainLife", player: "controller", amount: 1 }],
            },
        ]);
        expect(plans).toHaveLength(1);
        expect(plans[0]!.kind).toBe("skip");
    });

    it("reports an empty taken branch as a skip, never as covered", () => {
        const { plans, skipped } = planSmokeBranches([
            {
                op: "if",
                predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
                then: [{ op: "draw", player: "controller", count: 1 }],
            },
        ]);
        expect(plans.filter((p) => p.kind === "run")).toHaveLength(1);
        expect(skipped.map((k) => k.code)).toEqual(["no-assertable-outcome"]);
    });

    it("keeps the legacy skip for a predicate it cannot read", () => {
        const { plans, skipped } = planSmokeBranches([
            {
                op: "if",
                predicate: { binding: "paid" },
                then: [{ op: "draw", player: "controller", count: 1 }],
            },
        ]);
        expect(skipped).toEqual([]);
        expect(plans).toHaveLength(1);
        expect(plans[0]!.kind).toBe("skip");
        if (plans[0]!.kind === "skip")
            expect(plans[0]!.skips.map((k) => k.code)).toContain(
                "runtime-branch"
            );
    });
});

describe("a speed amount (CR 702.179f)", () => {
    const effects: EffectOp[] = [
        {
            op: "draw",
            player: "controller",
            count: { speed: { of: "controller" } },
        },
        {
            op: "loseLife",
            player: "controller",
            amount: { speed: { of: "controller" } },
        },
    ];

    function resolveAsSpell(plan: Extract<Plan, { kind: "run" }>): void {
        const id = "test-9600-speed-spell";
        registerTokenDefinition({
            id,
            name: id,
            rarity: "common",
            manaCost: { B: 1 },
            types: ["Sorcery"],
            effects,
        });
        plan.scenario.state.stack.push({
            ...makeInstance(id, {
                controllerId: CASTER_ID,
                ownerId: CASTER_ID,
                zone: "hand",
            }),
            castById: CASTER_ID,
            targets: [],
        });
        resolveTopOfStack(plan.scenario.state);
    }

    it("seeds the caster's speed and predicts the amount from it", () => {
        const plan = planSmokeTest(effects);
        expect(plan.kind).toBe("run");
        if (plan.kind !== "run") return;
        const caster = plan.scenario.state.players.find(
            (p) => p.id === CASTER_ID
        )!;
        expect(caster.speed).toBe(2);
        resolveAsSpell(plan);
        expect(failedAssertions(plan)).toEqual([]);
    });

    it("fails its assertions when the speed read is not the one seeded", () => {
        const plan = planSmokeTest(effects);
        if (plan.kind !== "run") throw new Error("expected a run plan");
        plan.scenario.state.players.find((p) => p.id === CASTER_ID)!.speed = 3;
        resolveAsSpell(plan);
        expect(failedAssertions(plan)).toHaveLength(2);
    });

    it("skips another player's speed with a reason", () => {
        const plan = planSmokeTest([
            {
                op: "gainLife",
                player: "controller",
                amount: { speed: { of: "opponent" } },
            },
        ]);
        expect(plan.kind).toBe("skip");
        if (plan.kind !== "skip") return;
        expect(plan.reason).toMatch(/speed of a player other than/);
    });
});

// CR 608.2h — "twice the number of …": the count is read once at resolution
// and scaled by the count set's fixed `times` multiplier.
describe("a count set's times multiplier (CR 608.2h)", () => {
    const effects: EffectOp[] = [
        {
            op: "gainLife",
            player: "controller",
            amount: {
                count: {
                    zone: "graveyard",
                    controller: "controller",
                    times: 2,
                },
            },
        },
    ];

    function resolveAsSpell(plan: Extract<Plan, { kind: "run" }>): void {
        const id = "test-4204-times-spell";
        registerTokenDefinition({
            id,
            name: id,
            rarity: "common",
            manaCost: { W: 1 },
            types: ["Sorcery"],
            effects,
        });
        plan.scenario.state.stack.push({
            ...makeInstance(id, {
                controllerId: CASTER_ID,
                ownerId: CASTER_ID,
                zone: "hand",
            }),
            castById: CASTER_ID,
            targets: [],
        });
        resolveTopOfStack(plan.scenario.state);
    }

    it("predicts the seeded set size times the multiplier", () => {
        const plan = planSmokeTest(effects);
        expect(plan.kind).toBe("run");
        if (plan.kind !== "run") return;
        // Seeded 3 cards in the caster's graveyard, ×2 → 6 life predicted.
        expect(plan.assertions[0].label).toContain("gainLife 6");
        resolveAsSpell(plan);
        expect(failedAssertions(plan)).toEqual([]);
    });
});

describe("a forced random pick moved to hand (CR 608.2c, CR 400.7)", () => {
    // Ghoulraiser's shape: "return a Zombie card at random from your graveyard
    // to your hand" — the pick, then the move.
    const pickThenMove = (
        pick: Partial<Extract<EffectOp, { op: "selectAtRandom" }>>,
        move: Partial<Extract<EffectOp, { op: "moveZone" }>> = {}
    ): EffectOp[] =>
        [
            {
                op: "selectAtRandom",
                zone: "graveyard",
                count: 1,
                bind: "$picked1",
                ...pick,
            },
            {
                op: "moveZone",
                cards: { ref: "$picked1" },
                player: "controller",
                from: "graveyard",
                to: "hand",
                ...move,
            },
        ] as EffectOp[];

    function resolveSpell(
        plan: Extract<Plan, { kind: "run" }>,
        effects: EffectOp[],
        id: string
    ): void {
        registerTokenDefinition({
            id,
            name: id,
            rarity: "common",
            manaCost: { B: 1 },
            types: ["Sorcery"],
            effects,
        });
        plan.scenario.state.stack.push({
            ...makeInstance(id, {
                controllerId: CASTER_ID,
                ownerId: CASTER_ID,
                zone: "hand",
            }),
            castById: CASTER_ID,
            targets: [],
        });
        resolveTopOfStack(plan.scenario.state);
    }

    const graveyardOf = (plan: Extract<Plan, { kind: "run" }>) =>
        plan.scenario.state.players.find((p) => p.id === CASTER_ID)!.graveyard;

    it.each<[string, Partial<Extract<EffectOp, { op: "selectAtRandom" }>>]>([
        ["a subtype filter", { filter: { subtype: "Zombie" } }],
        ["a type OR-filter", { filter: { type: ["Instant", "Sorcery"] } }],
        ["no filter, two cards", { count: 2 }],
    ])(
        "with %s executes through resolution and its declared outcome holds",
        (name, pick) => {
            const effects = pickThenMove(pick);
            const plan = planSmokeTest(effects);
            if (plan.kind !== "run") throw new Error(plan.reason);
            expect(plan.assertions.map((a) => a.label)).toEqual([
                expect.stringMatching(/^moveZone returns/),
            ]);
            expect(failedAssertions(plan)).not.toEqual([]);
            resolveSpell(plan, effects, `gen-pick-${name.replace(/\W/g, "")}`);
            expect(failedAssertions(plan)).toEqual([]);
        }
    );

    it("seeds count + 1 matching cards, and a card the filter passes over", () => {
        const plan = planSmokeTest(
            pickThenMove({ count: 2, filter: { type: "Creature" } })
        );
        if (plan.kind !== "run") throw new Error(plan.reason);
        const pool = plan.scenario.randomPools?.["$picked1"];
        expect(pool?.ids).toHaveLength(3);
        expect(pool?.decoyId).toBeDefined();
        expect(graveyardOf(plan).map((c) => c.id)).toEqual([
            ...pool!.ids,
            pool!.decoyId,
        ]);
        const unfiltered = planSmokeTest(pickThenMove({}));
        if (unfiltered.kind !== "run") throw new Error(unfiltered.reason);
        expect(unfiltered.scenario.randomPools?.["$picked1"]?.decoyId).toBe(
            undefined
        );
    });

    it("a mover that sends the picks elsewhere fails the assertion", () => {
        const plan = planSmokeTest(pickThenMove({}));
        if (plan.kind !== "run") throw new Error(plan.reason);
        resolveSpell(
            plan,
            pickThenMove({}, { to: "exile" }),
            "gen-pick-wrong-zone"
        );
        expect(failedAssertions(plan)).toHaveLength(1);
    });

    const PICK_SKIP = ["selectAtRandom", "randomness"];
    const MOVE_SKIP = ["moveZone", "unmodelled-object-or-zone"];
    it.each<[string, EffectOp[], string[][]]>([
        [
            "a pick from the hand",
            pickThenMove({ zone: "hand" }),
            [PICK_SKIP, MOVE_SKIP],
        ],
        [
            "a pick from an opponent's graveyard",
            pickThenMove({ zoneOwnerId: "opponent" }),
            [PICK_SKIP, MOVE_SKIP],
        ],
        [
            "a computed count",
            pickThenMove({ count: { X: true } }),
            [PICK_SKIP, ["selectAtRandom", "runtime-amount"], MOVE_SKIP],
        ],
        [
            "a filter on a characteristic the seeded card lacks",
            pickThenMove({ filter: { color: "B" } }),
            [PICK_SKIP, MOVE_SKIP],
        ],
        [
            "a move onto the battlefield",
            pickThenMove({}, { to: "battlefield", tapped: true }),
            [PICK_SKIP, MOVE_SKIP],
        ],
        [
            "a pick nothing moves",
            [
                pickThenMove({})[0]!,
                { op: "draw", player: "controller", count: 1 },
            ],
            [PICK_SKIP],
        ],
        [
            "a move of a binding no pick made",
            [pickThenMove({})[1]!],
            [MOVE_SKIP],
        ],
        [
            "a graveyard the same script discards into",
            [
                ...pickThenMove({}),
                { op: "discardAtRandom", player: "controller", count: 1 },
            ],
            [PICK_SKIP, MOVE_SKIP],
        ],
    ])("%s keeps the Ops' skips", (_name, effects, skips) => {
        const plan = planSmokeTest(effects);
        if (plan.kind !== "skip") throw new Error("expected a skip");
        expect(plan.skips.map((s) => [s.op?.op, s.code])).toEqual(skips);
    });

    it("a second pick in one script keeps the Op's skip", () => {
        const plan = planSmokeTest([
            ...pickThenMove({}),
            ...pickThenMove({}).map((op) =>
                JSON.parse(JSON.stringify(op).replace(/\$picked1/g, "$picked2"))
            ),
        ] as EffectOp[]);
        if (plan.kind !== "skip") throw new Error("expected a skip");
        expect(plan.skips.map((s) => [s.op?.op, s.code])).toEqual([
            PICK_SKIP,
            MOVE_SKIP,
        ]);
    });
});

describe("a discard pick answered by the canned run (CR 701.9a/b, CR 608.2d)", () => {
    // Mind Rot's shape: "Target player discards two cards." The affected player
    // chooses (CR 701.9b), and the discard moves what they chose.
    const pickThenDiscard = (
        player: unknown,
        count: number,
        choice: Record<string, unknown> = {},
        discard: Record<string, unknown> = {}
    ): EffectOp[] =>
        [
            {
                op: "choice",
                kind: "discard-hand",
                player,
                zone: "hand",
                count,
                prompt: "Discard a card.",
                bind: "$discard1",
                ...choice,
            },
            {
                op: "discard",
                player,
                cards: { ref: "$discard1" },
                ...discard,
            },
        ] as EffectOp[];

    function pushSpell(
        plan: Extract<Plan, { kind: "run" }>,
        effects: EffectOp[],
        id: string
    ): void {
        registerTokenDefinition({
            id,
            name: id,
            rarity: "common",
            manaCost: { B: 1 },
            types: ["Sorcery"],
            effects,
            ...(plan.scenario.targetKind === "player"
                ? { targetRequirement: { type: "player", count: 1 } }
                : {}),
        });
        plan.scenario.state.stack.push({
            ...makeInstance(id, {
                controllerId: CASTER_ID,
                ownerId: CASTER_ID,
                zone: "hand",
            }),
            castById: CASTER_ID,
            targets: plan.scenario.targets,
        });
    }

    const handOf = (plan: Extract<Plan, { kind: "run" }>, id: string) =>
        plan.scenario.state.players.find((p) => p.id === id)!.hand;

    it.each<[string, unknown, number, string]>([
        ["a targeted player, two cards", { target: 0 }, 2, OPPONENT_ID],
        ["the opponent, one card", "opponent", 1, OPPONENT_ID],
        ["the controller, one card", "controller", 1, CASTER_ID],
    ])(
        "with %s, seeds count + 1 cards and its chosen discard holds",
        (name, player, count, chooser) => {
            const effects = pickThenDiscard(player, count);
            const plan = planSmokeTest(effects);
            if (plan.kind !== "run") throw new Error(plan.reason);
            const answer = plan.scenario.choiceAnswers?.["$discard1"];
            expect(answer?.playerId).toBe(chooser);
            expect(answer?.handIds).toHaveLength(count + 1);
            expect(answer?.picks).toEqual(answer?.handIds.slice(1));
            expect(handOf(plan, chooser).map((c) => c.id)).toEqual(
                answer?.handIds
            );
            expect(plan.assertions.map((a) => a.label)).toEqual([
                expect.stringContaining(`hand ${count + 1}→1`),
            ]);
            pushSpell(plan, effects, `gen-discard-${name.replace(/\W/g, "")}`);
            resolveAnsweringChoices(plan.scenario.state, plan.scenario);
            expect(plan.scenario.state.pendingChoices).toBeUndefined();
            expect(failedAssertions(plan)).toEqual([]);
        }
    );

    it("an unanswered pick leaves the resolution suspended and fails the assertion", () => {
        const effects = pickThenDiscard("opponent", 1);
        const plan = planSmokeTest(effects);
        if (plan.kind !== "run") throw new Error(plan.reason);
        pushSpell(plan, effects, "gen-discard-unanswered");
        resolveTopOfStack(plan.scenario.state);
        expect(plan.scenario.state.pendingChoices).toHaveLength(1);
        expect(failedAssertions(plan)).toHaveLength(1);
    });

    it("a discard of the card left over, not the chosen one, fails the assertion", () => {
        const effects = pickThenDiscard("opponent", 1);
        const plan = planSmokeTest(effects);
        if (plan.kind !== "run") throw new Error(plan.reason);
        const answer = plan.scenario.choiceAnswers!["$discard1"]!;
        pushSpell(plan, effects, "gen-discard-other-card");
        resolveTopOfStack(plan.scenario.state);
        const head = plan.scenario.state.pendingChoices![0]!;
        applyPendingChoiceSubmit(plan.scenario.state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: answer.handIds.filter(
                (id) => !answer.picks.includes(id)
            ),
        });
        expect(handOf(plan, OPPONENT_ID)).toHaveLength(1);
        expect(failedAssertions(plan)).toHaveLength(1);
    });

    it.each<[string, EffectOp]>([
        [
            "the whole hand discarded",
            { op: "discard", player: "opponent" } as EffectOp,
        ],
        [
            "the chosen card exiled instead",
            {
                op: "moveZone",
                cards: { ref: "$discard1" },
                player: "opponent",
                from: "hand",
                to: "exile",
            } as EffectOp,
        ],
    ])("%s fails the assertion", (name, mover) => {
        const effects = pickThenDiscard("opponent", 1);
        const plan = planSmokeTest(effects);
        if (plan.kind !== "run") throw new Error(plan.reason);
        pushSpell(
            plan,
            [effects[0]!, mover],
            `gen-discard-${name.replace(/\W/g, "")}`
        );
        resolveAnsweringChoices(plan.scenario.state, plan.scenario);
        expect(plan.scenario.state.pendingChoices).toBeUndefined();
        expect(failedAssertions(plan)).toHaveLength(1);
    });

    it("a runtime-ref chooser names the ref as what holds the discard, never the binding", () => {
        // Oppression's shape: "Whenever a player casts a spell, that player
        // discards a card."
        const plan = planSmokeTest(
            pickThenDiscard({ ref: "$event.caster" }, 1)
        );
        if (plan.kind !== "skip") throw new Error("expected a skip");
        expect(plan.skips.map((s) => [s.op?.op, s.code])).toEqual([
            ["choice", "suspends-for-input"],
            ["choice", "runtime-amount"],
            ["discard", "runtime-amount"],
        ]);
        expect(
            plan.skips.filter((s) => /consumes a choice binding/.test(s.reason))
        ).toEqual([]);
    });

    const CHOICE_SKIP = ["choice", "suspends-for-input"];
    const DISCARD_SKIP = ["discard", "choice-binding"];
    it.each<[string, EffectOp[], string[][]]>([
        [
            "a pick from another zone owner",
            pickThenDiscard("opponent", 1, { zoneOwnerId: "controller" }),
            [CHOICE_SKIP, DISCARD_SKIP],
        ],
        [
            "a ranged count",
            pickThenDiscard("opponent", 1, { count: { min: 0, max: 1 } }),
            [CHOICE_SKIP, DISCARD_SKIP],
        ],
        [
            "a filtered pick",
            pickThenDiscard("opponent", 1, { filter: { type: "Creature" } }),
            [CHOICE_SKIP, DISCARD_SKIP],
        ],
        [
            "a discard by another player",
            [
                pickThenDiscard("opponent", 1)[0]!,
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$discard1" },
                },
            ],
            [CHOICE_SKIP, DISCARD_SKIP],
        ],
        [
            "a pick nothing discards",
            [
                pickThenDiscard("opponent", 1)[0]!,
                { op: "draw", player: "controller", count: 1 },
            ],
            [CHOICE_SKIP],
        ],
        [
            "a whole-hand discard",
            [{ op: "discard", player: "opponent" }],
            [DISCARD_SKIP],
        ],
        [
            "a hand the same script draws into",
            [
                { op: "draw", player: "controller", count: 1 },
                ...pickThenDiscard("controller", 1),
            ],
            [CHOICE_SKIP, DISCARD_SKIP],
        ],
        [
            "a hand the same script also discards at random",
            [
                ...pickThenDiscard("opponent", 1),
                { op: "discardAtRandom", player: "opponent", count: 1 },
            ],
            [CHOICE_SKIP, DISCARD_SKIP],
        ],
        [
            "a second pick in one script",
            [
                ...pickThenDiscard("opponent", 1),
                ...pickThenDiscard("controller", 1).map((op) =>
                    JSON.parse(
                        JSON.stringify(op).replace(/\$discard1/g, "$discard2")
                    )
                ),
            ],
            [CHOICE_SKIP, DISCARD_SKIP],
        ],
    ])("%s keeps the Ops' skips", (_name, effects, skips) => {
        const plan = planSmokeTest(effects);
        if (plan.kind !== "skip") throw new Error("expected a skip");
        expect(plan.skips.map((s) => [s.op?.op, s.code])).toEqual(skips);
    });
});

/** Resolves `effects` as a TRIGGERED ability carrying the plan's firing event —
 *  the shape the catalogue sweep pushes for a plan with a `triggerEvent`: the
 *  interpreter reads `$event` refs off the stack item's `triggerEvent`. */
function resolveAsTrigger(
    plan: Extract<Plan, { kind: "run" }>,
    effects: EffectOp[],
    hostId: string
): void {
    const event = plan.scenario.triggerEvent!;
    registerTokenDefinition({
        id: hostId,
        name: hostId,
        rarity: "common",
        manaCost: { W: 1 },
        types: ["Enchantment"],
        triggeredAbilities: [
            {
                id: `${hostId}-tr`,
                oracleText: "smoke",
                event: event.type,
                matches: () => true,
                effects,
            },
        ],
    });
    const source = makeInstance(hostId, {
        id: `${hostId}-src`,
        controllerId: CASTER_ID,
        ownerId: CASTER_ID,
        zone: "battlefield",
    });
    plan.scenario.state.players
        .find((p) => p.id === CASTER_ID)!
        .battlefield.push(source);
    plan.scenario.state.stack.push({
        ...source,
        zone: "stack",
        castById: CASTER_ID,
        triggeredAbilityId: `${hostId}-tr`,
        triggerSourceId: source.id,
        triggerEvent: event,
        targets: plan.scenario.targets,
    });
    resolveTopOfStack(plan.scenario.state);
}

describe("$event object subjects — the object a trigger's firing event names (ADR 0049)", () => {
    const counterOnCombatant: EffectOp[] = [
        {
            op: "counters",
            action: "add",
            counter: "+1/+1",
            target: { ref: "$event.combatant" },
            count: 1,
        },
    ];
    const triggeredOn = (event: GameEventType | GameEventType[]) =>
        abilityHost({ types: ["Enchantment"] }, true, false, event);

    // CR 508.3a — "whenever a creature you control attacks, put a +1/+1
    // counter on it"; CR 509.3a — the blocker twin of the same field.
    it.each<[string, GameEventType | GameEventType[]]>([
        ["an attack trigger", "ATTACKERS_DECLARED"],
        ["a block trigger", "BLOCKER_DECLARED"],
        [
            "an attacks-or-blocks trigger",
            ["ATTACKERS_DECLARED", "BLOCKER_DECLARED"],
        ],
    ])(
        "%s's counter on the event's creature executes and its outcome holds",
        (name, event) => {
            const plan = planSmokeTest(counterOnCombatant, triggeredOn(event));
            expect(plan.kind).toBe("run");
            if (plan.kind !== "run") return;
            expect(plan.scenario.eventSubject?.permanentId).toBe(
                EVENT_SUBJECT_PERMANENT_ID
            );
            const subject = plan.scenario.state.players
                .find((p) => p.id === CASTER_ID)!
                .battlefield.find((c) => c.id === EVENT_SUBJECT_PERMANENT_ID);
            expect(subject).toBeDefined();
            // Unresolved, the counter is missing — a green below is the Op's.
            expect(failedAssertions(plan)).not.toEqual([]);
            resolveAsTrigger(
                plan,
                counterOnCombatant,
                `gen-test-event-${name.replace(/\W+/g, "-")}`
            );
            expect(failedAssertions(plan)).toEqual([]);
        }
    );

    it.each<[string, ReturnType<typeof abilityHost>]>([
        // An activated ability's item carries no firing event to read.
        [
            "an activated host",
            abilityHost({ types: ["Enchantment"] }, true, true),
        ],
        // No builder names an object for this event's `combatant`.
        [
            "a trigger with no builder for the field",
            triggeredOn("CREATURE_DIED"),
        ],
    ])("%s keeps the $event subject a card-dependent skip", (_name, host) => {
        const plan = planSmokeTest(counterOnCombatant, host);
        if (plan.kind !== "skip") throw new Error("expected a skip");
        expect(plan.skips.map((s) => s.code)).toEqual([
            "source-or-each-subject",
        ]);
        expect(SMOKE_SKIP_CLASS["source-or-each-subject"]).toBe(
            "card-dependent"
        );
    });

    it("a count set beside the event subject is a skip, not a guess", () => {
        const plan = planSmokeTest(
            [
                ...counterOnCombatant,
                {
                    op: "gainLife",
                    player: "controller",
                    amount: {
                        count: { type: "Creature", controller: "controller" },
                    },
                },
            ] as EffectOp[],
            triggeredOn("ATTACKERS_DECLARED")
        );
        if (plan.kind !== "skip") throw new Error("expected a skip");
        expect(plan.skips.map((s) => s.code)).toEqual(["runtime-amount"]);
        expect(plan.reason).toMatch(/seeded \$event\.combatant permanent/);
    });
});

describe("$event number amounts — the magnitude a trigger's firing event carries (CR 120.3, ADR 0049)", () => {
    const loseThatMuch: EffectOp[] = [
        {
            op: "loseLife",
            player: "controller",
            amount: { ref: "$event.amount" },
        },
    ];
    const dealThatMuch: EffectOp[] = [
        {
            op: "dealDamage",
            amount: { ref: "$event.amount" },
            to: { target: 0 },
        },
    ];
    const damageTakenHost = (onBattlefield = true) =>
        abilityHost(
            { types: ["Creature"], subtypes: ["Dog"], power: 2, toughness: 2 },
            onBattlefield,
            false,
            "DAMAGE_DEALT"
        );

    // CR 120.3 — "whenever this creature is dealt damage, you lose that much
    // life" / "it deals that much damage to any target".
    it.each<[string, EffectOp[]]>([
        ["lose that much life", loseThatMuch],
        ["deal that much damage", dealThatMuch],
    ])(
        "%s reads the seeded event's amount and its outcome holds",
        (name, effects) => {
            const plan = planSmokeTest(effects, damageTakenHost());
            expect(plan.kind).toBe("run");
            if (plan.kind !== "run") return;
            const event = plan.scenario.triggerEvent;
            expect(event?.type).toBe("DAMAGE_DEALT");
            const amount = event?.type === "DAMAGE_DEALT" ? event.amount : 0;
            expect(plan.scenario.eventAmount).toEqual({
                ref: "$event.amount",
                amount,
            });
            expect(plan.assertions.map((a) => a.label).join(" ")).toContain(
                String(amount)
            );
            // Unresolved, no life moved — a green below is the Op's.
            expect(failedAssertions(plan)).not.toEqual([]);
            resolveAsTrigger(
                plan,
                effects,
                `gen-test-event-amount-${name.replace(/\W+/g, "-")}`
            );
            expect(failedAssertions(plan)).toEqual([]);
        }
    );

    it.each<[string, ReturnType<typeof abilityHost>]>([
        // An activated ability's item carries no firing event to read.
        ["an activated host", abilityHost({ types: ["Creature"] }, true, true)],
        // No builder carries a number in this event's `amount`.
        [
            "a trigger with no builder for the field",
            abilityHost({ types: ["Creature"] }, true, false, "CREATURE_DIED"),
        ],
    ])("%s keeps the $event amount a card-dependent skip", (_name, host) => {
        const plan = planSmokeTest(loseThatMuch, host);
        if (plan.kind !== "skip") throw new Error("expected a skip");
        expect(plan.reason).toBe(
            'numeric ref "$event.amount" — amount depends on a runtime snapshot'
        );
    });

    // The magnitude is fixed when the damage is dealt: a creature the damage
    // killed still has its trigger read "that much" off the event.
    it("a host gone by resolution still reads the event's amount", () => {
        const plan = planSmokeTest(loseThatMuch, damageTakenHost(false));
        expect(plan.kind).toBe("run");
        if (plan.kind !== "run") return;
        expect(plan.scenario.sourcePermanentId).toBeUndefined();
        resolveAsTrigger(plan, loseThatMuch, "gen-test-event-amount-departed");
        expect(failedAssertions(plan)).toEqual([]);
    });
});
