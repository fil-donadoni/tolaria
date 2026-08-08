// AVR — green card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { craterhoofBehemoth } from "../green";
import { grizzlyBears } from "../../lea/green";
import { resolveTopOfStack } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { finalizeCleanup } from "../../../../gre/phases";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";

function craterhoofEntered(instanceId: string, controllerId: string) {
    return {
        type: "PERMANENT_ENTERED" as const,
        instanceId,
        controllerId,
        cardId: craterhoofBehemoth.id,
        types: ["Creature"] as const,
    };
}

describe("Craterhoof Behemoth (CR 603.6a self-ETB, 611.2c one-shot mass pump + 611.1b trample grant — issue #2372)", () => {
    it("with 3 creatures you control (including itself), each gets +3/+3 and trample until end of turn", () => {
        const craterhoof = makeInstance(craterhoofBehemoth.id, {
            id: "craterhoof-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const bear1 = makeInstance(grizzlyBears.id, {
            id: "bear-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const bear2 = makeInstance(grizzlyBears.id, {
            id: "bear-2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const opponentBear = makeInstance(grizzlyBears.id, {
            id: "opp-bear-1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [craterhoof, bear1, bear2] }),
                makePlayer("p2", { battlefield: [opponentBear] }),
            ],
        });

        // Baseline: Craterhoof 5/5, bears 2/2, no trample yet.
        expect(getEffectivePower(state, craterhoof)).toBe(5);
        expect(getEffectiveToughness(state, craterhoof)).toBe(5);
        expect(craterhoof.staticAbilities).not.toContain("trample");

        const triggers = collectTriggers(state, [
            craterhoofEntered("craterhoof-1", "p1"),
        ]);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        resolveTopOfStack(state);

        // X = 3 (Craterhoof counts itself, CR 603.6a — it has already entered
        // by the time its own ETB trigger resolves).
        expect(getEffectivePower(state, craterhoof)).toBe(8); // 5 + 3
        expect(getEffectiveToughness(state, craterhoof)).toBe(8);
        expect(craterhoof.staticAbilities).toContain("trample");

        expect(getEffectivePower(state, bear1)).toBe(5); // 2 + 3
        expect(getEffectiveToughness(state, bear1)).toBe(5);
        expect(bear1.staticAbilities).toContain("trample");
        expect(getEffectivePower(state, bear2)).toBe(5);
        expect(getEffectiveToughness(state, bear2)).toBe(5);
        expect(bear2.staticAbilities).toContain("trample");

        // Opponent's creature is untouched — "creatures YOU control" only.
        expect(getEffectivePower(state, opponentBear)).toBe(2);
        expect(getEffectiveToughness(state, opponentBear)).toBe(2);
        expect(opponentBear.staticAbilities).not.toContain("trample");

        // CR 514.2 — the pump and the trample grant both expire at cleanup.
        // `tickDuration` gates an "end-of-turn" boundary on `state.phase ===
        // "CLEANUP"` (gre/state.ts), so the fixture must reach that phase
        // before ticking.
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(getEffectivePower(state, craterhoof)).toBe(5);
        expect(getEffectiveToughness(state, craterhoof)).toBe(5);
        expect(craterhoof.staticAbilities).not.toContain("trample");
        expect(getEffectivePower(state, bear1)).toBe(2);
        expect(bear1.staticAbilities).not.toContain("trample");
    });

    it("alone on an empty board, X = 1 — Craterhoof becomes a 6/6", () => {
        const craterhoof = makeInstance(craterhoofBehemoth.id, {
            id: "craterhoof-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [craterhoof] }),
                makePlayer("p2"),
            ],
        });

        const triggers = collectTriggers(state, [
            craterhoofEntered("craterhoof-1", "p1"),
        ]);
        state.stack.push(...triggers);
        resolveTopOfStack(state);

        expect(getEffectivePower(state, craterhoof)).toBe(6); // 5 + 1
        expect(getEffectiveToughness(state, craterhoof)).toBe(6);
        expect(craterhoof.staticAbilities).toContain("trample");
    });

    it("wire format: the mass pump and trample grant survive projectPublicState", () => {
        const craterhoof = makeInstance(craterhoofBehemoth.id, {
            id: "craterhoof-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const bear1 = makeInstance(grizzlyBears.id, {
            id: "bear-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [craterhoof, bear1] }),
                makePlayer("p2"),
            ],
        });

        const triggers = collectTriggers(state, [
            craterhoofEntered("craterhoof-1", "p1"),
        ]);
        state.stack.push(...triggers);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        const slimCraterhoof = projected.players[0].battlefield.find(
            (c) => c.id === "craterhoof-1"
        )!;
        const slimBear = projected.players[0].battlefield.find(
            (c) => c.id === "bear-1"
        )!;

        expect(getEffectivePower(projected, slimCraterhoof)).toBe(7); // 5 + 2
        expect(getEffectiveToughness(projected, slimCraterhoof)).toBe(7);
        expect(slimCraterhoof.staticAbilities).toContain("trample");
        expect(getEffectivePower(projected, slimBear)).toBe(4); // 2 + 2
        expect(slimBear.staticAbilities).toContain("trample");
    });
});
