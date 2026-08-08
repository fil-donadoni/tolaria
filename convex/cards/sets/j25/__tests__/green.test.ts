// J25 (Foundations Jumpstart) — green card behavior tests (ADR 0043 colour
// split). Scythecat Cub's Landfall targeting is now a REAL announcement-time
// target (CR 603.3d, issue #1193): a `targetRequirement` on the
// TriggeredAbility, driven by `raiseTriggerTargetSelection` +
// `finalizeTargetSelection`, not a resolution-time `requestChoice`. The
// resolution-count-gated doubling stays an imperative `resolve()` reading the
// announced `ctx.targets[0]`, so the card earns a hand-written test per
// `.claude/rules/gre-development.md`.

import { describe, it, expect } from "vitest";
import { scythecatCub } from "../green";
import { swamp, grizzlyBears } from "../../lea";
import { resolveTopOfStack } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";

/** Synthesizes the PERMANENT_ENTERED event a land drop emits (CR 603.6a). */
function landEntered(instanceId: string, controllerId: string) {
    return {
        type: "PERMANENT_ENTERED" as const,
        instanceId,
        controllerId,
        cardId: swamp.id,
        types: ["Land"] as const,
    };
}

function setup() {
    const cub = makeInstance(scythecatCub.id, {
        id: "cub",
        controllerId: "p1",
        ownerId: "p1",
    });
    const bear = makeInstance(grizzlyBears.id, {
        id: "bear",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [cub, bear] }),
            makePlayer("p2"),
        ],
    });
    return { state, cub, bear };
}

/** Puts one landfall trigger on the stack and drives its CR 603.3d target
 *  choice through the real machinery. With 2+ legal creatures
 *  `raiseTriggerTargetSelection` raises a `kind:"trigger"` PendingTarget which
 *  we finalize with the chosen target; with exactly one legal target it
 *  auto-selects (returns false) and we assert the locked slot. */
function resolveLandfall(
    state: ReturnType<typeof setup>["state"],
    n: number,
    targetId: string
): void {
    state.stack.push(
        ...collectTriggers(state, [landEntered(`land${n}`, "p1")])
    );
    const raised = raiseTriggerTargetSelection(state);
    if (raised) {
        const pt = state.pendingTarget!;
        pt.selected = [{ type: "permanent", id: targetId }];
        finalizeTargetSelection(state, pt, pt.playerId);
    } else {
        // Sole mandatory target auto-selected (CR 603.3d).
        const trig = state.stack[state.stack.length - 1];
        expect(trig.targets).toEqual([{ type: "permanent", id: targetId }]);
    }
    expect(resolveTopOfStack(state)).not.toBeNull();
}

describe("Scythecat Cub (CR 603.6a Landfall / 122 counters, issue #1189)", () => {
    it("mandatory single target auto-selects when exactly one creature is legal (CR 603.3d)", () => {
        // Only the Cub itself is on the battlefield → the sole legal "creature
        // you control" is auto-selected; no PendingTarget is raised.
        const cub = makeInstance(scythecatCub.id, {
            id: "cub",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cub] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push(
            ...collectTriggers(state, [landEntered("land1", "p1")])
        );
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        const trig = state.stack[state.stack.length - 1];
        expect(trig.targets).toEqual([{ type: "permanent", id: "cub" }]);
        expect(resolveTopOfStack(state)).not.toBeNull();
        const cubLive = state.players[0].battlefield.find(
            (c) => c.id === "cub"
        )!;
        expect(cubLive.counters?.["+1/+1"]).toBe(1);
    });

    it("landfall, first resolution this turn: puts ONE +1/+1 counter on the chosen creature", () => {
        const { state, bear } = setup();
        resolveLandfall(state, 1, "bear");
        const bearLive = state.players[0].battlefield.find(
            (c) => c.id === bear.id
        )!;
        expect(bearLive.counters?.["+1/+1"]).toBe(1);
        expect(getEffectivePower(state, bearLive)).toBe(3);
        expect(getEffectiveToughness(state, bearLive)).toBe(3);
    });

    it("landfall, second resolution the same turn: DOUBLES the counters instead of adding one", () => {
        const { state, bear } = setup();
        resolveLandfall(state, 1, "bear"); // 0 -> 1 (first resolution: +1)
        resolveLandfall(state, 2, "bear"); // 1 -> 2 (second resolution: doubled)
        const bearLive = state.players[0].battlefield.find(
            (c) => c.id === bear.id
        )!;
        expect(bearLive.counters?.["+1/+1"]).toBe(2);
    });

    it("landfall, third resolution the same turn: back to adding ONE counter (only the second time doubles)", () => {
        const { state, bear } = setup();
        resolveLandfall(state, 1, "bear"); // 0 -> 1
        resolveLandfall(state, 2, "bear"); // 1 -> 2 (doubled)
        resolveLandfall(state, 3, "bear"); // 2 -> 3 (plain +1, NOT doubled to 4)
        const bearLive = state.players[0].battlefield.find(
            (c) => c.id === bear.id
        )!;
        expect(bearLive.counters?.["+1/+1"]).toBe(3);
    });

    it("landfall: an OPPONENT's land entering does NOT trigger (CR 109.2 — you control)", () => {
        const { state } = setup();
        const triggers = collectTriggers(state, [landEntered("oland", "p2")]);
        expect(triggers).toHaveLength(0);
    });

    it("survives the wire projection (doubled counters are server-computed)", () => {
        const { state, bear } = setup();
        resolveLandfall(state, 1, "bear");
        resolveLandfall(state, 2, "bear");
        const bearLive = state.players[0].battlefield.find(
            (c) => c.id === bear.id
        )!;
        expect(bearLive.counters?.["+1/+1"]).toBe(2);
        const projected = projectPublicState(state, 1, "p1");
        const slimBear = projected.players[0].battlefield.find(
            (c) => c.id === bear.id
        )!;
        expect(slimBear.counters?.["+1/+1"]).toBe(2);
        expect(getEffectivePower(projected, slimBear)).toBe(4);
        expect(getEffectiveToughness(projected, slimBear)).toBe(4);
    });
});
