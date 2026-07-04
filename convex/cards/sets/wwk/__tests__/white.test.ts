// WWK — per-card behavior tests for white cards in
// `convex/cards/sets/wwk/white.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import { stoneforgeMystic } from "../white";
import { grizzlyBears } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { registerTokenDefinition } from "../../..";

// No Equipment card is registered in the catalogue yet — a synthetic
// test-only Equipment definition for the hand/library fixtures (mirrors the
// convention in convex/cards/sets/ody/__tests__/black.test.ts).
const sword = { id: "test-wwk-equipment" };
registerTokenDefinition({
    id: sword.id,
    name: "Test Equipment",
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Artifact"],
    subtypes: ["Equipment"],
});

describe("Stoneforge Mystic (CR 603.6a ETB / 701.19 / 400.7 / 701.20, issue #677)", () => {
    it("ETB: may search for an Equipment card and put it into hand (optional, count 0..1)", () => {
        const mystic = makeInstance(stoneforgeMystic.id, {
            id: "mystic1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const libSword = makeInstance(sword.id, {
            id: "sword1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const libBear = makeInstance(grizzlyBears.id, {
            id: "bear1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [mystic],
                    library: [libSword, libBear],
                }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...mystic,
            id: "trig-mystic-etb",
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "stoneforge-mystic-etb-search",
            triggerSourceId: "mystic1",
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: "mystic1",
                controllerId: "p1",
                types: mystic.types,
            },
            targets: [],
        });
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.candidateIds).toEqual(["sword1"]);
        expect(head.count).toEqual({ min: 0, max: 1 });
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["sword1"],
        });
        expect(state.players[0].hand.map((c) => c.id)).toContain("sword1");
    });

    it("second ability: may put an Equipment card from hand onto the battlefield", () => {
        const mystic = makeInstance(stoneforgeMystic.id, {
            id: "mystic1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const handSword = makeInstance(sword.id, {
            id: "sword1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [mystic],
                    hand: [handSword],
                }),
                makePlayer("p2"),
            ],
        });
        const src = state.players[0].battlefield[0];
        state.stack.push({
            ...src,
            zone: "stack",
            castById: "p1",
            abilityId: "stoneforge-mystic-drop",
            targets: [],
        });
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-hand-card");
        expect(head.candidateIds).toEqual(["sword1"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["sword1"],
        });
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "sword1"
        );
    });
});
