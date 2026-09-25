// Unit tests for the canned-scenario auto-test generator (issue #804). Covers
// the three moving parts the acceptance criteria call out: scenario
// construction, per-Op assertion derivation, and unsatisfiable-requirement
// reporting (an explicit skip with a reason, never a silent pass). The
// end-to-end sweep that RUNS the generated plans over the real catalogue lives
// in `convex/cards/__tests__/effectScriptSmoke.test.ts`.

import { describe, it, expect } from "vitest";
import type { EffectOp } from "../../../cards/types";
import { registerTokenDefinition } from "../../../cards";
import {
    abilityHost,
    activatedAbilitySourceOnBattlefield,
    ASSERTED_OP_KINDS,
    compiledTriggerSourceOnBattlefield,
    CASTER_ID,
    FILLER_CARD_DEFINITION,
    OPPONENT_ID,
    opCoverageGaps,
    planSmokeTest,
    SMOKE_SKIP_CLASS,
    SMOKE_SKIP_CODES,
    SOURCE_PERMANENT_ID,
    SPELL_HOST,
    triggeredAbilitySourceOnBattlefield,
    type Plan,
} from "../scenarioGenerator";
import { EFFECT_OP_REGISTRY } from "../../../cards/mechanicsRegistry";
import { makeInstance } from "../../../cards/__tests__/setup";
import { resolveTopOfStack } from "../../state";
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
        // canned scenario has no way to answer, so the plan is an explicit
        // skip with a reason (never a silent pass or a crash). Execution
        // coverage for choice cards comes from their own suspension/resume
        // tests.
        const plan = planSmokeTest([
            {
                op: "choice",
                kind: "discard-hand",
                player: { target: 0 },
                zone: "hand",
                count: 2,
                prompt: "discard two cards",
                bind: "$picked",
            },
            { op: "discard", player: { target: 0 }, cards: { ref: "$picked" } },
        ] as EffectOp[]);
        expect(plan.kind).toBe("skip");
        if (plan.kind !== "skip") return;
        expect(plan.reason).toMatch(/choice|player input/i);
    });
});

describe("Op vocabulary coverage guard (issue #804)", () => {
    it("every registered Effect Op has a scenario assertor (no silent gap)", () => {
        expect(opCoverageGaps()).toEqual([]);
    });

    it("ASSERTED_OP_KINDS matches the registry exactly", () => {
        expect([...ASSERTED_OP_KINDS].sort()).toEqual(
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
 * is a real analyser, whatever it then does with `undefined`.
 */
function scenarioOpDisposition(
    name: EffectOp["op"]
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
    } catch {
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
    hostId: string
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
        targets: [],
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
