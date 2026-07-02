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
    ASSERTED_OP_KINDS,
    CASTER_ID,
    FILLER_CARD_ID,
    FILLER_SUBTYPE,
    OPPONENT_ID,
    opCoverageGaps,
    planSmokeTest,
} from "../scenarioGenerator";
import { EFFECT_OP_REGISTRY } from "../../../cards/mechanicsRegistry";

// The generator references FILLER_CARD_ID by id; register it once here (and the
// sweep registers it too — `registerTokenDefinition` is idempotent).
registerTokenDefinition({
    id: FILLER_CARD_ID,
    name: FILLER_CARD_ID,
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: [FILLER_SUBTYPE],
    power: 2,
    toughness: 5,
});

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
