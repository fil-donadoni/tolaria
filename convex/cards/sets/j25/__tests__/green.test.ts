// J25 (Foundations Jumpstart) — green card behavior tests (ADR 0043 colour
// split). Scythecat Cub's Landfall targeting is a `resolve()` card (protocol
// note in `sets/j25/green.ts` — no trigger-level `targetRequirement`, tracked
// as tolaria#917), so it earns a hand-written test per
// `.claude/rules/gre-development.md`.

import { describe, it, expect } from "vitest";
import { scythecatCub } from "../green";
import { swamp, grizzlyBears } from "../../lea";
import { resolveTopOfStack } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
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

/** Resolves one landfall trigger to completion, submitting the mandatory
 *  target-creature pick (Bristly Bill / Luminarch Aspirant pattern). */
function resolveLandfall(
    state: ReturnType<typeof setup>["state"],
    n: number,
    targetId: string
): void {
    state.stack.push(
        ...collectTriggers(state, [landEntered(`land${n}`, "p1")])
    );
    expect(resolveTopOfStack(state)).toBeNull(); // suspended for the target pick
    const pending = state.pendingChoices![0];
    expect(pending.kind).toBe("choose-permanents");
    applyPendingChoiceSubmit(state, {
        playerId: "p1",
        stackItemId: pending.stackItemId,
        step: pending.step,
        choiceId: pending.choiceId,
        cardInstanceIds: [targetId],
    });
}

describe("Scythecat Cub (CR 603.6a Landfall / 122 counters, issue #1189)", () => {
    it("shape: 2/2 trample for {X}{G} with the Landfall trigger declared", () => {
        expect(scythecatCub.manaCost).toEqual({ X: 1, G: 1 });
        expect(scythecatCub.power).toBe(2);
        expect(scythecatCub.toughness).toBe(2);
        expect(scythecatCub.staticAbilities).toContain("trample");
        expect(scythecatCub.triggeredAbilities).toHaveLength(1);
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
