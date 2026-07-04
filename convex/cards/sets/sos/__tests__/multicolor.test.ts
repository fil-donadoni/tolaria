// SOS (Secrets of Strixhaven) — multicolor behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import {
    traumaticCritique,
    witherbloomCharm,
    silverquillCharm,
} from "../multicolor";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import {
    applyPendingChoiceSubmit,
    applyMayPaySubmit,
} from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";

const CREATURE_ID = "6914c5a8-2114-41c5-a471-ca97524d622f"; // Sabretooth Tiger
// A NON-creature artifact (Black Lotus, mv 0 — no toughness, so it can't die
// to an unrelated SBA and mask a broken sacrifice/destroy).
const ARTIFACT_ID = "b0faa7f2-b547-42c4-a810-839da50dadfe"; // Black Lotus

describe("Traumatic Critique (X damage + draw two, discard one; CR 107.3 / 115.4 / 121.1)", () => {
    it("is an {X}{U}{R} instant targeting any target", () => {
        expect(traumaticCritique.manaCost).toEqual({ X: "X", U: 1, R: 1 });
        expect(traumaticCritique.types).toEqual(["Instant"]);
        expect(traumaticCritique.targetRequirement).toMatchObject({
            type: "any",
            count: 1,
        });
    });

    it("deals X damage to a player, draws two, then discards one", () => {
        const lib = [0, 1].map((i) =>
            makeInstance(traumaticCritique.id, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const handCard = makeInstance(traumaticCritique.id, {
            id: "h0",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib, hand: [handCard] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        const item = pushSpell(state, traumaticCritique.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 3;

        // First resolution step: 3 damage to p2 + draw 2 (irreversible), then
        // it suspends on the discard choice.
        const first = resolveTopOfStack(state);
        expect(first).toBeNull(); // suspended on the discard pick
        expect(state.players[1].life).toBe(17); // 20 - 3
        // Drew 2 (lib0, lib1) added to the pre-existing hand card.
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "h0",
            "lib0",
            "lib1",
        ]);

        // Submit the discard choice (discard the original hand card).
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h0"],
        });
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "lib0",
            "lib1",
        ]);
        expect(state.players[0].graveyard.some((c) => c.id === "h0")).toBe(
            true
        );
    });

    it("wire format: the damage and net card count survive projection", () => {
        const lib = [0, 1].map((i) =>
            makeInstance(traumaticCritique.id, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const handCard = makeInstance(traumaticCritique.id, {
            id: "h0",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib, hand: [handCard] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        const item = pushSpell(state, traumaticCritique.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h0"],
        });
        // p1 drew 2, discarded 1 → net hand of 2; p2 at 18 life.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand.length).toBe(2);
        expect(projected.players[1].life).toBe(18);
    });
});

describe("Witherbloom Charm (CR 700.2 modal — may-sacrifice, life gain, or destroy)", () => {
    it("declares three modes; only the destroy mode targets", () => {
        expect(witherbloomCharm.modes).toHaveLength(3);
        const destroy = witherbloomCharm.modes!.find(
            (m) => m.id === "destroy"
        )!;
        expect(destroy.targetRequirement).toMatchObject({
            mvFilter: { max: 2 },
        });
        expect(
            witherbloomCharm.modes!.find((m) => m.id === "sacrifice-draw")!
                .targetRequirement
        ).toBeUndefined();
        expect(
            witherbloomCharm.modes!.find((m) => m.id === "gain-life")!
                .targetRequirement
        ).toBeUndefined();
    });

    it("sacrifice-draw mode: accepting sacrifices a permanent and draws two (CR 701.16 / 121.1)", () => {
        const fodder = makeInstance(ARTIFACT_ID, {
            id: "fodder",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lib = [0, 1].map((i) =>
            makeInstance(traumaticCritique.id, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fodder], library: lib }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, witherbloomCharm.id, "p1");
        item.chosenModeId = "sacrifice-draw";
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on may-pay
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(
            state.players[0].battlefield.some((c) => c.id === "fodder")
        ).toBe(false);
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "lib0",
            "lib1",
        ]);
    });

    it("sacrifice-draw mode: declining draws nothing and sacrifices nothing", () => {
        const fodder = makeInstance(ARTIFACT_ID, {
            id: "fodder",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fodder] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, witherbloomCharm.id, "p1");
        item.chosenModeId = "sacrifice-draw";
        expect(resolveTopOfStack(state)).toBeNull();
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(
            state.players[0].battlefield.some((c) => c.id === "fodder")
        ).toBe(true);
        expect(state.players[0].hand).toHaveLength(0);
    });

    it("gain-life mode: you gain 5 life (CR 119.3a)", () => {
        const state = makeState({
            players: [makePlayer("p1", { life: 20 }), makePlayer("p2")],
        });
        const item = pushSpell(state, witherbloomCharm.id, "p1");
        item.chosenModeId = "gain-life";
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(25);
    });

    it("destroy mode: destroys target nonland permanent with mana value 2 or less (CR 701.7)", () => {
        const cheapArtifact = makeInstance(ARTIFACT_ID, {
            id: "cheap",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [cheapArtifact] }),
            ],
        });
        const item = pushSpell(state, witherbloomCharm.id, "p1", [
            { type: "permanent", id: "cheap" },
        ]);
        item.chosenModeId = "destroy";
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.some((c) => c.id === "cheap")).toBe(
            false
        );
    });
});

describe("Silverquill Charm (CR 700.2 modal — counters, exile-weak-creature, or drain)", () => {
    it("declares three modes; only the drain mode has no target", () => {
        expect(silverquillCharm.modes).toHaveLength(3);
        expect(
            silverquillCharm.modes!.find((m) => m.id === "counters")!
                .targetRequirement
        ).toMatchObject({ type: "Creature" });
        expect(
            silverquillCharm.modes!.find((m) => m.id === "exile")!
                .targetRequirement
        ).toMatchObject({ powerFilter: { max: 2 } });
        expect(
            silverquillCharm.modes!.find((m) => m.id === "drain")!
                .targetRequirement
        ).toBeUndefined();
    });

    it("counters mode: puts two +1/+1 counters on target creature (CR 122.1)", () => {
        const creature = makeInstance(CREATURE_ID, {
            id: "creature-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [creature] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, silverquillCharm.id, "p1", [
            { type: "permanent", id: "creature-1" },
        ]);
        item.chosenModeId = "counters";
        resolveTopOfStack(state);
        const perm = state.players[0].battlefield.find(
            (c) => c.id === "creature-1"
        )!;
        expect(perm.counters?.["+1/+1"]).toBe(2);
    });

    it("exile mode: exiles target creature with power 2 or less (CR 701.13)", () => {
        const weakling = makeInstance(CREATURE_ID, {
            id: "weakling",
            controllerId: "p2",
            ownerId: "p2",
            power: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [weakling] }),
            ],
        });
        const item = pushSpell(state, silverquillCharm.id, "p1", [
            { type: "permanent", id: "weakling" },
        ]);
        item.chosenModeId = "exile";
        resolveTopOfStack(state);
        expect(state.players[1].exile.some((c) => c.id === "weakling")).toBe(
            true
        );
    });

    it("drain mode: each opponent loses 3 life and you gain 3 (CR 119.3)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        const item = pushSpell(state, silverquillCharm.id, "p1");
        item.chosenModeId = "drain";
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(23);
        expect(state.players[1].life).toBe(17);
    });
});
