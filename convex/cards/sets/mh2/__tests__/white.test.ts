// MH2 white — per-colour card behavior tests (ADR 0043 parallel test file).
import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type { GameState } from "../../../../gre/state";
import { resolveTopOfStack } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";
import { solitude } from "../white";
import { serraAngel } from "../../lea";

// Solitude — {3}{W}{W} Creature Elemental Incarnation, 3/2 (Vintage Cube,
// issue #900). "Flash. Lifelink. When this creature enters, exile up to one
// other target creature. That creature's controller gains life equal to its
// power. Evoke—Exile a white card from your hand."
//
// The ETB "exile up to one OTHER target creature" is a REAL target chosen when
// the trigger is put on the stack (CR 603.3d, issue #1193 machinery:
// `targetRequirement` + `raiseTriggerTargetSelection` in gre/rules.ts), NOT a
// resolution-time `requestChoice`. `excludeSource` self-excludes Solitude
// ("other"); `count 0..1` = "up to one"; life gain reads the target's power
// BEFORE exile (CR 613 last-known information). The evoke alt-cost / ETB
// sacrifice half is covered in convex/gre/__tests__/evoke.test.ts.

/** Puts a resolved Solitude on p1's battlefield alongside p2's Serra Angel
 *  (power 4), fires Solitude's ETB through the REAL trigger path
 *  (`collectTriggers`), and pushes it onto the stack. `buildTriggerItem` sets
 *  the trigger's `triggerSourceId`, so `excludeSource` can drop Solitude. */
function setupSolitudeEtb(): GameState {
    const solitudePermanent = makeInstance(solitude.id, {
        id: "solitude",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    const serra = makeInstance(serraAngel.id, {
        id: "serra",
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [solitudePermanent] }),
            makePlayer("p2", { battlefield: [serra] }),
        ],
    });
    const triggers = collectTriggers(state, [
        {
            type: "PERMANENT_ENTERED",
            instanceId: "solitude",
            controllerId: "p1",
            cardId: solitude.id,
            types: ["Creature"],
        },
    ]).filter((t) => t.triggeredAbilityId === "solitude-etb");
    state.stack.push(...triggers);
    return state;
}

/** Drives the CR 603.3d target choice through the real machinery:
 *  `raiseTriggerTargetSelection` raises the `kind:"trigger"` PendingTarget
 *  (count 0..1), then `finalizeTargetSelection` writes the chosen target
 *  (or the empty "decline" set) onto the on-stack trigger. */
function chooseSolitudeTarget(state: GameState, targetId: string | null) {
    const raised = raiseTriggerTargetSelection(state);
    expect(raised).toBe(true);
    state.pendingTarget!.selected = targetId
        ? [{ type: "permanent", id: targetId }]
        : [];
    finalizeTargetSelection(
        state,
        state.pendingTarget!,
        state.pendingTarget!.playerId
    );
}

describe("Solitude — definition", () => {
    it("pins mana cost, stats, subtypes, keywords, and the ETB trigger", () => {
        expect(solitude.manaCost).toEqual({ X: 3, W: 2 });
        expect(solitude.types).toEqual(["Creature"]);
        expect(solitude.subtypes).toEqual(["Elemental", "Incarnation"]);
        expect(solitude.power).toBe(3);
        expect(solitude.toughness).toBe(2);
        expect(solitude.staticAbilities).toEqual(["flash", "lifelink"]);
        expect(solitude.triggeredAbilities?.[0]?.id).toBe("solitude-etb");
    });

    it("declares the CR 603.3d target requirement: up to one other creature", () => {
        expect(solitude.triggeredAbilities?.[0]?.targetRequirement).toEqual({
            type: "Creature",
            count: { min: 0, max: 1 },
            excludeSource: true,
        });
    });
});

describe("Solitude ETB (CR 603.3d target + CR 603.6a exile, LKI life gain)", () => {
    it("exiles the chosen creature; its controller gains life equal to its power read BEFORE exile (LKI)", () => {
        const state = setupSolitudeEtb();
        // p2's Serra Angel (power 4) is chosen at stack placement.
        chooseSolitudeTarget(state, "serra");
        const trig = state.stack[state.stack.length - 1];
        expect(trig.targets).toEqual([{ type: "permanent", id: "serra" }]);
        expect(resolveTopOfStack(state)).not.toBeNull();

        // (a) The target is exiled from the battlefield.
        expect(state.players[1].battlefield.some((c) => c.id === "serra")).toBe(
            false
        );
        expect(state.players[1].exile.some((c) => c.id === "serra")).toBe(true);
        // (b) Its controller (p2) gained life equal to its power (4), read
        // while it was still on the battlefield — a post-exile read would see
        // 0, so 24 proves the LKI ordering.
        expect(state.players[1].life).toBe(24);
        // (c) Solitude itself was NOT exiled (excludeSource held through the
        // real target selection — "up to one OTHER").
        expect(
            state.players[0].battlefield.some((c) => c.id === "solitude")
        ).toBe(true);

        // Wire format — the exile move and the life total are board-visible and
        // must survive the projection (re-run the assertion post-projection).
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[1].battlefield.some((c) => c.id === "serra")
        ).toBe(false);
        expect(projected.players[1].life).toBe(24);
    });

    it("'up to one' — declining (empty target set) exiles nothing and gains no life", () => {
        const state = setupSolitudeEtb();
        chooseSolitudeTarget(state, null);
        const trig = state.stack[state.stack.length - 1];
        expect(trig.targets).toEqual([]);
        expect(resolveTopOfStack(state)).not.toBeNull();
        // Serra survives, nobody gains life.
        expect(state.players[1].battlefield.some((c) => c.id === "serra")).toBe(
            true
        );
        expect(state.players[1].life).toBe(20);
    });

    it("excludes Solitude herself — with no other creature, resolves as a no-op (CR 603.3d 'other')", () => {
        // Solitude alone on the battlefield: the only creature is herself,
        // dropped by `excludeSource`. "Up to one" with none legal locks an
        // empty target set, raises no PendingTarget, and resolves as a no-op.
        const solitudePermanent = makeInstance(solitude.id, {
            id: "solitude",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [solitudePermanent] }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "solitude",
                controllerId: "p1",
                cardId: solitude.id,
                types: ["Creature"],
            },
        ]).filter((t) => t.triggeredAbilityId === "solitude-etb");
        const trig = triggers[0]!;
        state.stack.push(trig);

        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(trig.targets).toEqual([]);
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.pendingTarget).toBeUndefined();
        // Solitude survives its own ETB.
        expect(
            state.players[0].battlefield.some((c) => c.id === "solitude")
        ).toBe(true);
    });
});
