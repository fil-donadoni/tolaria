// Pile division — divide-then-choose (ADR 0053, CR 608.2 / 101.4, issue
// #1067). Per-Op tests for the two new Ops the cluster introduces:
// `divideIntoPiles` (the two-step DividePilesKind pending-choice family) and
// `restrictCombat` (the "can't attack"/"can't block this turn" restriction
// grant, CR 508.1a / 509.1b). Follows the same real-resolution-path
// convention as every other Op test in `interpreter.test.ts` — a synthetic
// DSL-only card is registered, pushed on the stack and resolved via
// `resolveTopOfStack`, with a wire-format assertion through
// `projectPublicState` (ADR 0045/0046 testing convention).

import { describe, it, expect } from "vitest";
import type { CardDefinition, EffectOp } from "../../../cards/types";
import { registerTokenDefinition } from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup";
import { resolveTopOfStack } from "../../state";
import { applyPendingChoiceSubmit } from "../../pendingChoiceSubmit";
import { compactState, expandState } from "../../serialize";
import { projectPublicState } from "../../../gameProjections";
import {
    validateAttackerEligibility,
    validateBlockerEligibility,
} from "../../combat";
import { finalizeCleanup } from "../../phases";

function registerScript(
    id: string,
    effects: EffectOp[],
    extra: Partial<CardDefinition> = {}
): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        effects,
        ...extra,
    });
    return id;
}

const BEAR_ID = "test-pile-bear";
registerTokenDefinition({
    id: BEAR_ID,
    name: BEAR_ID,
    rarity: "common",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
});

const creaturesOf = (owner: "p1" | "p2", ids: string[]) =>
    ids.map((cid) =>
        makeInstance(BEAR_ID, { id: cid, controllerId: owner, ownerId: owner })
    );

describe("Effect Script Op: divideIntoPiles (ADR 0053, pile division)", () => {
    it("suspends for the divider's partition, then for the chooser's pick, then destroys the CHOSEN pile", () => {
        const id = registerScript("test-divide-destroy", [
            {
                op: "divideIntoPiles",
                objects: {
                    set: "permanents",
                    zone: "battlefield",
                    controller: "opponent",
                    filter: { type: "Creature" },
                },
                divider: "controller",
                chooser: "opponent",
                dividePrompt: "Divide the creatures into two piles.",
                pickPrompt: "Choose a pile.",
                chosenBind: "$chosen",
                otherBind: "$other",
                chosenEffect: [
                    {
                        op: "forEach",
                        select: { set: "bound", ref: "$chosen" },
                        effects: [{ op: "destroy", target: { ref: "$each" } }],
                    },
                ],
                otherEffect: [],
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: creaturesOf("p2", ["c1", "c2", "c3"]),
                }),
            ],
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended (step 1)

        // Step 1: p1 (divider) partitions — c1 becomes pile A, c2/c3 pile B.
        let head = state.pendingChoices![0];
        expect(head.kind).toBe("divide-piles");
        expect(head.playerId).toBe("p1");
        expect(head.zone).toBe("battlefield");
        expect(head.zoneOwnerId).toBe("p2");
        expect(head.candidateIds?.slice().sort()).toEqual(["c1", "c2", "c3"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["c1"],
        });

        // Step 2: p2 (chooser) picks a pile — the second pending choice.
        expect(state.stack).toHaveLength(1); // still suspended
        head = state.pendingChoices![0];
        expect(head.kind).toBe("pick-pile");
        expect(head.playerId).toBe("p2");
        expect(head.pileA).toEqual(["c1"]);
        expect(head.pileB?.slice().sort()).toEqual(["c2", "c3"]);

        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["A"],
        });

        // Pile A (c1) was chosen and destroyed; pile B (c2, c3) survives
        // (otherEffect is empty).
        expect(state.players[1].battlefield.map((c) => c.id).sort()).toEqual([
            "c2",
            "c3",
        ]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["c1"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("destroys the OTHER pile when the chooser picks B", () => {
        const id = registerScript("test-divide-destroy-b", [
            {
                op: "divideIntoPiles",
                objects: {
                    set: "permanents",
                    zone: "battlefield",
                    controller: "opponent",
                    filter: { type: "Creature" },
                },
                divider: "controller",
                chooser: "opponent",
                dividePrompt: "Divide.",
                pickPrompt: "Choose.",
                chosenBind: "$chosen",
                otherBind: "$other",
                chosenEffect: [
                    {
                        op: "forEach",
                        select: { set: "bound", ref: "$chosen" },
                        effects: [{ op: "destroy", target: { ref: "$each" } }],
                    },
                ],
                otherEffect: [],
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: creaturesOf("p2", ["c1", "c2"]),
                }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const divide = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: divide.stackItemId,
            step: divide.step,
            choiceId: divide.choiceId,
            cardInstanceIds: ["c1"], // pile A = [c1], pile B = [c2]
        });
        const pick = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: pick.stackItemId,
            step: pick.step,
            choiceId: pick.choiceId,
            cardInstanceIds: ["B"], // choose pile B — c2 is destroyed, c1 survives
        });
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual(["c1"]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["c2"]);
    });

    it("runs BOTH chosenEffect and otherEffect (Bend or Break shape: destroy chosen, tap other)", () => {
        const id = registerScript("test-divide-both-effects", [
            {
                op: "divideIntoPiles",
                objects: {
                    set: "permanents",
                    zone: "battlefield",
                    controller: "controller",
                    filter: { type: "Creature" },
                },
                divider: "controller",
                chooser: "opponent",
                dividePrompt: "Divide.",
                pickPrompt: "Choose.",
                chosenBind: "$chosen",
                otherBind: "$other",
                chosenEffect: [
                    {
                        op: "forEach",
                        select: { set: "bound", ref: "$chosen" },
                        effects: [{ op: "destroy", target: { ref: "$each" } }],
                    },
                ],
                otherEffect: [
                    {
                        op: "forEach",
                        select: { set: "bound", ref: "$other" },
                        effects: [
                            {
                                op: "tapUntap",
                                action: "tap",
                                target: { ref: "$each" },
                            },
                        ],
                    },
                ],
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: creaturesOf("p1", ["c1", "c2"]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const divide = state.pendingChoices![0];
        expect(divide.playerId).toBe("p1");
        expect(divide.zoneOwnerId).toBe("p1");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: divide.stackItemId,
            step: divide.step,
            choiceId: divide.choiceId,
            cardInstanceIds: ["c1"],
        });
        const pick = state.pendingChoices![0];
        expect(pick.playerId).toBe("p2");
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: pick.stackItemId,
            step: pick.step,
            choiceId: pick.choiceId,
            cardInstanceIds: ["A"],
        });
        // The graveyard also holds the resolved sorcery itself (CR 608.2k) —
        // assert containment, not exact equality.
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("c1");
        const c2 = state.players[0].battlefield.find((c) => c.id === "c2");
        expect(c2?.isTapped).toBe(true);
    });

    it("is a no-op when the object set is empty (CR 608.2b)", () => {
        const id = registerScript("test-divide-empty", [
            {
                op: "divideIntoPiles",
                objects: {
                    set: "permanents",
                    zone: "battlefield",
                    controller: "opponent",
                    filter: { type: "Creature" },
                },
                divider: "controller",
                chooser: "opponent",
                dividePrompt: "Divide.",
                pickPrompt: "Choose.",
                chosenBind: "$chosen",
                otherBind: "$other",
                chosenEffect: [
                    {
                        op: "forEach",
                        select: { set: "bound", ref: "$chosen" },
                        effects: [{ op: "destroy", target: { ref: "$each" } }],
                    },
                ],
                otherEffect: [],
            },
        ]);
        const state = makeState();
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.card.id)).toContain(id);
    });

    it("survives the wire projection: the pick-pile choice's pileA/pileB cross the wire to both viewers", () => {
        const id = registerScript("test-divide-wire", [
            {
                op: "divideIntoPiles",
                objects: {
                    set: "permanents",
                    zone: "battlefield",
                    controller: "opponent",
                    filter: { type: "Creature" },
                },
                divider: "controller",
                chooser: "opponent",
                dividePrompt: "Divide.",
                pickPrompt: "Choose.",
                chosenBind: "$chosen",
                otherBind: "$other",
                chosenEffect: [],
                otherEffect: [],
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: creaturesOf("p2", ["c1", "c2"]),
                }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const divide = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: divide.stackItemId,
            step: divide.step,
            choiceId: divide.choiceId,
            cardInstanceIds: ["c1"],
        });
        const pick = state.pendingChoices![0];
        expect(pick.kind).toBe("pick-pile");

        const projectedForChooser = projectPublicState(state, 1, "p2");
        const projectedHead = projectedForChooser.pendingChoices![0];
        expect(projectedHead.kind).toBe("pick-pile");
        expect(projectedHead.pileA).toEqual(["c1"]);
        expect(projectedHead.pileB).toEqual(["c2"]);

        // The other viewer sees the identical pile assignment too (public
        // information, CR 608.2 — both players know the division once made).
        const projectedForDivider = projectPublicState(state, 1, "p1");
        expect(projectedForDivider.pendingChoices![0].pileA).toEqual(["c1"]);
        expect(projectedForDivider.pendingChoices![0].pileB).toEqual(["c2"]);
    });
});

describe("Effect Script Op: restrictCombat (CR 508.1a / 509.1b, ADR 0053)", () => {
    it("cant-attack sets cantAttackThisTurn, rejected by validateAttackerEligibility", () => {
        const id = registerScript("test-restrict-cant-attack", [
            {
                op: "restrictCombat",
                restriction: "cant-attack",
                target: { target: 0 },
            },
        ]);
        const bear = makeInstance(BEAR_ID, {
            id: "restrict-bear-1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [
            { type: "permanent", id: "restrict-bear-1" },
        ]);
        resolveTopOfStack(state);
        const card = state.players[1].battlefield[0];
        expect(card.cantAttackThisTurn).toBe(true);
        expect(validateAttackerEligibility(card).eligible).toBe(false);
    });

    it("cant-block sets cantBlockThisTurn, rejected by validateBlockerEligibility", () => {
        const id = registerScript("test-restrict-cant-block", [
            {
                op: "restrictCombat",
                restriction: "cant-block",
                target: { target: 0 },
            },
        ]);
        const attacker = makeInstance(BEAR_ID, {
            id: "attacker-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blocker = makeInstance(BEAR_ID, {
            id: "restrict-bear-2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        pushSpell(state, id, "p1", [
            { type: "permanent", id: "restrict-bear-2" },
        ]);
        resolveTopOfStack(state);
        const card = state.players[1].battlefield[0];
        expect(card.cantBlockThisTurn).toBe(true);
        expect(
            validateBlockerEligibility(attacker, card, [card]).eligible
        ).toBe(false);
    });

    it("cantAttackThisTurn is cleared at CLEANUP (CR 514.2)", () => {
        const bear = makeInstance(BEAR_ID, {
            id: "cleanup-bear",
            controllerId: "p1",
            ownerId: "p1",
            cantAttackThisTurn: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        finalizeCleanup(state);
        expect(
            state.players[0].battlefield[0].cantAttackThisTurn
        ).toBeUndefined();
    });

    it("survives the wire projection (battlefield permanents are spread whole)", () => {
        const id = registerScript("test-restrict-wire", [
            {
                op: "restrictCombat",
                restriction: "cant-attack",
                target: { target: 0 },
            },
        ]);
        const bear = makeInstance(BEAR_ID, {
            id: "restrict-wire-bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, id, "p1", [
            { type: "permanent", id: "restrict-wire-bear" },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "restrict-wire-bear"
        );
        expect(slim?.cantAttackThisTurn).toBe(true);
    });

    it("round-trips cantAttackThisTurn through serialize/expand (drift guard)", () => {
        const bear = makeInstance(BEAR_ID, {
            id: "serialize-bear",
            controllerId: "p1",
            ownerId: "p1",
            cantAttackThisTurn: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        const compact = compactState(state);
        const expanded = expandState(compact);
        expect(expanded.players[0].battlefield[0].cantAttackThisTurn).toBe(
            true
        );
    });
});
