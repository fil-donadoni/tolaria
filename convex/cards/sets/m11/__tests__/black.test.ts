// M11 (Magic 2011) — black behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { mindRot } from "../black";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    assertExpectedInput,
    refreshExpectedInput,
} from "../../../../gre/expectedInput";
import { checkStateBasedActions } from "../../../../gre/sba";
import { validateEffectScript } from "../../../../gre/effects/validate";
import { projectPublicState } from "../../../../gameProjections";
import { registerTokenDefinition } from "../../..";

// A filler card for the target player's hand.
const FILLER_ID = "test-m11-filler";
registerTokenDefinition({
    id: FILLER_ID,
    name: FILLER_ID,
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
});

const handOf = (owner: string, ids: string[]) =>
    ids.map((cid) =>
        makeInstance(FILLER_ID, {
            id: cid,
            controllerId: owner,
            ownerId: owner,
            zone: "hand",
        })
    );

// Mind Rot — "Target player discards two cards." (CR 701.9.) The first DSL
// card with a MID-RESOLUTION choice (ADR 0045, issue #805): cast → the script
// suspends at the `choice` Op (a `discard-hand` Pending Choice for the target
// player, through the existing prompt pipeline) → the player submits via the
// generic `submitResolutionChoice` mutation → the script resumes at the
// `discard` Op and discards the picks.
describe("Mind Rot (target player discards two cards — DSL-only mid-resolution choice, CR 701.9 / issue #805)", () => {
    it("is a {2}{B} sorcery targeting a player, DSL-only with a valid Effect Script", () => {
        expect(mindRot.manaCost).toEqual({ X: 2, B: 1 });
        expect(mindRot.types).toEqual(["Sorcery"]);
        expect(mindRot.targetRequirement).toEqual({
            type: "player",
            count: 1,
        });
        expect(mindRot.resolve).toBeUndefined();
        expect(mindRot.resolveSteps).toBeUndefined();
        expect(validateEffectScript(mindRot)).toEqual([]);
    });

    it("suspends on a discard-hand choice for the TARGET player, then discards the two picks (CR 701.9)", () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: handOf("p2", ["h1", "h2", "h3"]) }),
            ],
        });
        pushSpell(state, mindRot.id, "p1", [{ type: "player", id: "p2" }]);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the choice
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("discard-hand");
        expect(head.playerId).toBe("p2"); // the TARGET chooses, not the caster
        expect(head.zone).toBe("hand");
        expect(head.count).toBe(2);
        expect(head.prompt).toBe("Mind Rot: choose two cards to discard.");
        // CR 608.3 — the sorcery stays on the stack across the wait.
        expect(state.stack.map((s) => s.card.id)).toEqual([mindRot.id]);

        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h1", "h3"],
        });
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["h2"]);
        expect(state.players[1].graveyard.map((c) => c.id).sort()).toEqual([
            "h1",
            "h3",
        ]);
        // Resolution completed (CR 608.2k) — Mind Rot in its owner's graveyard.
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].graveyard.map((c) => c.card.id)).toContain(
            mindRot.id
        );
    });

    it("discards only one card when the hand has one (CR 701.9b), and skips entirely on an empty hand (CR 608.2b)", () => {
        // One card in hand → the choice clamps to 1.
        const one = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: handOf("p2", ["only"]) }),
            ],
        });
        pushSpell(one, mindRot.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(one);
        const head = one.pendingChoices![0];
        expect(head.count).toBe(1);
        applyPendingChoiceSubmit(one, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["only"],
        });
        expect(one.players[1].hand).toHaveLength(0);
        expect(one.players[1].graveyard.map((c) => c.id)).toEqual(["only"]);

        // Empty hand → no choice at all; the spell still finishes resolving.
        const empty = makeState();
        pushSpell(empty, mindRot.id, "p1", [{ type: "player", id: "p2" }]);
        expect(resolveTopOfStack(empty)).not.toBeNull();
        expect(empty.pendingChoices).toBeUndefined();
        expect(empty.players[0].graveyard.map((c) => c.card.id)).toContain(
            mindRot.id
        );
    });

    it("backend integration: the Expected Input gate + generic submit sequence accepts the chooser and rejects the caster (ADR 0047, issue #805)", () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: handOf("p2", ["h1", "h2"]) }),
            ],
        });
        pushSpell(state, mindRot.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        // ADR 0047 — the engine maintains the Expected Input at the stable
        // point; the scripted choice must surface EXACTLY like a
        // resolve()-based one.
        refreshExpectedInput(state);
        expect(state.expectedInput).toEqual({
            kind: "choice",
            playerId: "p2",
            stackItemId: state.pendingChoices![0].stackItemId,
            choiceId: "$discards",
            choiceKind: "discard-hand",
        });

        // Mirror the `submitResolutionChoice` mutation handler exactly:
        // gate → applyPendingChoiceSubmit → SBAs.
        expect(() =>
            assertExpectedInput(state, { playerId: "p1", expect: "choice" })
        ).toThrow(); // the caster is NOT the chooser
        assertExpectedInput(state, { playerId: "p2", expect: "choice" });
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h1", "h2"],
        });
        checkStateBasedActions(state);
        expect(state.players[1].hand).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(2);
    });

    it("wire format: the suspended choice, the Expected Input and the discard outcome survive projection", () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: handOf("p2", ["h1", "h2", "h3"]) }),
            ],
        });
        pushSpell(state, mindRot.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        refreshExpectedInput(state);

        // The chooser's client sees the pending choice + the Expected Input.
        const suspended = projectPublicState(state, 1, "p2");
        const head = suspended.pendingChoices![0];
        expect(head.kind).toBe("discard-hand");
        expect(head.playerId).toBe("p2");
        expect(head.prompt).toBe("Mind Rot: choose two cards to discard.");
        expect(suspended.expectedInput?.kind).toBe("choice");
        expect(suspended.expectedInput?.playerId).toBe("p2");

        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h1", "h3"],
        });
        refreshExpectedInput(state);
        // Both viewers observe the discard outcome after the resume.
        for (const viewer of ["p1", "p2"]) {
            const projected = projectPublicState(state, 2, viewer);
            expect(projected.players[1].hand).toHaveLength(1);
            expect(
                projected.players[1].graveyard.map((c) => c.id).sort()
            ).toEqual(["h1", "h3"]);
            expect(projected.pendingChoices).toBeUndefined();
        }
    });
});
