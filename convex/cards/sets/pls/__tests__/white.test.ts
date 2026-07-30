// PLS (Planeshift) — white card behavior tests (ADR 0043 colour split).
// Each card's describe block cites the CR section it exercises.
import { describe, it, expect } from "vitest";
import { lashknifeBarrier } from "../white";
import { crawWurm } from "../../lea/green";
import { lightningBolt } from "../../lea/red";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import { resolveTopOfStack, runDamageReplacement } from "../../../../gre/state";

describe("Lashknife Barrier ({2}{W} Enchantment — damage reduction, CR 614)", () => {
    it("is a {2}{W} Enchantment with the modern oracle text", () => {
        expect(lashknifeBarrier.manaCost).toEqual({ X: 2, W: 1 });
        expect(lashknifeBarrier.types).toEqual(["Enchantment"]);
        expect(lashknifeBarrier.oracleText).toBe(
            "When this enchantment enters, draw a card.\nIf a source would deal damage to a creature you control, it deals that much damage minus 1 to that creature instead."
        );
    });

    it("declares a single ETB trigger that draws a card (per-Op regime — draw is already exercised)", () => {
        expect(lashknifeBarrier.triggeredAbilities).toHaveLength(1);
        expect(lashknifeBarrier.triggeredAbilities?.[0]?.effects).toEqual([
            { op: "draw", player: "controller", count: 1 },
        ]);
    });

    it("reduces damage from any source to a creature its controller controls by 1 (CR 614)", () => {
        const barrier = makeInstance(lashknifeBarrier.id, {
            id: "barrier",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [barrier, bear] }),
                makePlayer("p2", { battlefield: [] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "some-source",
            "p2",
            { type: "permanent", id: "bear" },
            3,
            false
        );
        expect(res?.amount).toBe(2);
    });

    it("floors the reduction at 0 — a 1-damage source deals none", () => {
        const barrier = makeInstance(lashknifeBarrier.id, {
            id: "barrier",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [barrier, bear] }),
                makePlayer("p2", { battlefield: [] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "some-source",
            "p2",
            { type: "permanent", id: "bear" },
            1,
            false
        );
        expect(res?.amount).toBe(0);
    });

    it("does not apply to a creature the barrier's controller doesn't control", () => {
        const barrier = makeInstance(lashknifeBarrier.id, {
            id: "barrier",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppBear = makeInstance(crawWurm.id, {
            id: "opp-bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [barrier] }),
                makePlayer("p2", { battlefield: [oppBear] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "some-source",
            "p1",
            { type: "permanent", id: "opp-bear" },
            3,
            false
        );
        expect(res?.amount).toBe(3);
    });

    it("does not apply to damage dealt to a player (only creatures)", () => {
        const barrier = makeInstance(lashknifeBarrier.id, {
            id: "barrier",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [barrier] }),
                makePlayer("p2", { battlefield: [] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "some-source",
            "p2",
            { type: "player", id: "p1" },
            3,
            false
        );
        expect(res?.amount).toBe(3);
    });

    it("holds through the real damage pipeline and survives the wire projection (CR 614)", () => {
        const barrier = makeInstance(lashknifeBarrier.id, {
            id: "barrier",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [barrier, bear] }),
                makePlayer("p2", { battlefield: [] }),
            ],
        });
        // Lightning Bolt (LEA): "deals 3 damage to any target" — the real DSL
        // dealDamage Op path (SpellContext.dealDamage -> runDamageReplacement)
        // that every damage source in the engine funnels through.
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        expect(resolveTopOfStack(state)).not.toBeNull();

        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.damageMarked).toBe(2); // 3 - 1

        const projected = projectPublicState(state, 0, "p1");
        const slimBear = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(slimBear?.damageMarked).toBe(2);
    });
});
