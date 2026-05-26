// Tests for the client-buffered submission helper (ADR 0007). Exercises
// the atomic validation + dispatch path that backs the
// `submitResolutionChoice` mutation. Slice #80 only handles `discard-hand`.

import { describe, it, expect } from "vitest";
import { resolveTopOfStack, type GameState } from "../state";
import { advancePhase, untapStep } from "../phases";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import {
    disruptingScepter,
    grizzlyBears,
    lightningBolt,
    plains,
    winterOrb,
} from "../../cards/sets/lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";

function setupCleanupDiscard(handSize: number): GameState {
    const hand = Array.from({ length: handSize }, (_, i) =>
        makeInstance(grizzlyBears.id, {
            id: `p1-card-${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        })
    );
    const state = makeState({
        phase: "END_STEP",
        turn: 1,
        activePlayerId: "p1",
        players: [makePlayer("p1", { hand }), makePlayer("p2")],
    });
    // Driving END_STEP → CLEANUP via advancePhase enqueues the CR 514.1
    // discard-hand pending choice with the correct `count = excess` and
    // `stackItemId === ""` marker.
    advancePhase(state);
    return state;
}

function setupScepterDiscard(handIds: string[]): GameState {
    const scepter = makeInstance(disruptingScepter.id, {
        id: "scepter",
        controllerId: "p1",
        ownerId: "p1",
    });
    const hand = handIds.map((id) =>
        makeInstance(grizzlyBears.id, {
            id,
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [scepter] }),
            makePlayer("p2", { hand }),
        ],
    });
    const ability = disruptingScepter.activatedAbilities![0];
    const item = pushSpell(state, disruptingScepter.id, "p1", [
        { type: "player", id: "p2" },
    ]);
    item.abilityId = ability.id;
    resolveTopOfStack(state);
    return state;
}

describe("applyPendingChoiceSubmit — discard-hand mid-resolution (CR 608.2)", () => {
    it("happy path: writes ids into stackItem.collectedChoices and resumes resolve", () => {
        const state = setupScepterDiscard(["h1", "h2"]);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("discard-hand");
        expect(head.playerId).toBe("p2");

        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h1"],
        });

        // Resolution completed: scepter ability resolved, h1 discarded to
        // p2's graveyard, stack empty, no more pending choices.
        expect(state.stack.length).toBe(0);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["h2"]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["h1"]);
    });

    it("rejects when identity (stackItemId/step/choiceId/playerId) doesn't match the queue head", () => {
        const state = setupScepterDiscard(["h1"]);
        const head = state.pendingChoices![0];

        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p2",
                stackItemId: "WRONG",
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["h1"],
            })
        ).toThrow(/stale/i);

        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p2",
                stackItemId: head.stackItemId,
                step: 999,
                choiceId: head.choiceId,
                cardInstanceIds: ["h1"],
            })
        ).toThrow(/stale/i);

        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["h1"],
            })
        ).toThrow(/stale/i);
    });

    it("rejects duplicate ids in the submission", () => {
        // Need a count >= 2 pending choice — use cleanup (count = 2) instead
        // of Scepter (count = 1).
        const state = setupCleanupDiscard(9);
        const head = state.pendingChoices![0];

        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["p1-card-0", "p1-card-0"],
            })
        ).toThrow(/duplicate/i);
    });

    it("rejects when count is below min", () => {
        const state = setupCleanupDiscard(9);
        const head = state.pendingChoices![0];
        expect(head.count).toBe(2);

        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["p1-card-0"],
            })
        ).toThrow(/at least/i);
    });

    it("rejects when count is above max", () => {
        const state = setupScepterDiscard(["h1", "h2"]);
        const head = state.pendingChoices![0];
        expect(head.count).toBe(1);

        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p2",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["h1", "h2"],
            })
        ).toThrow(/at most/i);
    });

    it("rejects when a submitted id is not in the chooser's hand", () => {
        const state = setupScepterDiscard(["h1"]);
        const head = state.pendingChoices![0];

        // Card id from another player / nonexistent zone — must be rejected.
        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p2",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["scepter"],
            })
        ).toThrow(/not in hand/i);
    });

    it("validates against the zoneOwner's hand when zoneOwnerId is set", () => {
        // Scepter targets p2 → zoneOwnerId === playerId === p2 (default).
        // Submitting a card from p1's hand should fail.
        const state = setupScepterDiscard(["h1"]);
        const p1Card = makeInstance(lightningBolt.id, {
            id: "p1-card",
            ownerId: "p1",
            controllerId: "p1",
            zone: "hand",
        });
        state.players[0].hand.push(p1Card);
        const head = state.pendingChoices![0];

        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p2",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["p1-card"],
            })
        ).toThrow(/not in hand/i);
    });
});

describe("applyPendingChoiceSubmit — discard-hand cleanup (CR 514.1)", () => {
    it("happy path: routes through finalizeCleanupDiscard and advances past CLEANUP", () => {
        const state = setupCleanupDiscard(9);
        const head = state.pendingChoices![0];
        expect(head.stackItemId).toBe("");
        expect(head.count).toBe(2);

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["p1-card-0", "p1-card-1"],
        });

        // finalizeCleanupDiscard ran: cards in graveyard, hand at max, queue
        // empty, pendingCleanupDiscard cleared, phase advanced out of CLEANUP.
        expect(state.players[0].hand.length).toBe(7);
        expect(state.players[0].graveyard.map((c) => c.id).sort()).toEqual([
            "p1-card-0",
            "p1-card-1",
        ]);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.pendingCleanupDiscard).toBeUndefined();
        expect(state.phase).not.toBe("CLEANUP");
    });

    it("rejects identity mismatch on a cleanup discard too", () => {
        const state = setupCleanupDiscard(9);

        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: "non-empty-id",
                step: 0,
                choiceId: "cleanup-discard-p1",
                cardInstanceIds: ["p1-card-0", "p1-card-1"],
            })
        ).toThrow(/stale/i);
    });
});

// ---------------------------------------------------------------------------
// untap-pick (CR 502.1) — cap-style restriction commit (Winter Orb, Smoke)
// ---------------------------------------------------------------------------

function setupUntapPick(tappedLandCount: number): GameState {
    const orb = makeInstance(winterOrb.id, {
        id: "orb",
        controllerId: "p1",
        ownerId: "p1",
    });
    const lands = Array.from({ length: tappedLandCount }, (_, i) =>
        makeInstance(plains.id, {
            id: `land-${i}`,
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        })
    );
    const state = makeState({
        phase: "UNTAP",
        activePlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: [orb, ...lands] }),
            makePlayer("p2"),
        ],
    });
    // Trigger the untap dispatcher to enqueue the untap-pick choice.
    untapStep(state);
    return state;
}

describe("applyPendingChoiceSubmit — untap-pick (CR 502.1)", () => {
    it("happy path: untaps the chosen land and advances past UNTAP", () => {
        const state = setupUntapPick(3);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("untap-pick");
        expect(head.count).toEqual({ min: 0, max: 1 });

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["land-1"],
        });

        // land-1 untapped, others still tapped, phase advanced past UNTAP.
        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "land-1")!.isTapped).toBe(false);
        expect(bf.find((c) => c.id === "land-0")!.isTapped).toBe(true);
        expect(bf.find((c) => c.id === "land-2")!.isTapped).toBe(true);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.phase).not.toBe("UNTAP");
    });

    it("skip (empty list, min===0): untaps nothing and still advances", () => {
        const state = setupUntapPick(2);
        const head = state.pendingChoices![0];

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [],
        });

        // Both lands still tapped, phase advanced.
        expect(
            state.players[0].battlefield.filter((c) => c.isTapped).length
        ).toBe(2);
        expect(state.phase).not.toBe("UNTAP");
    });

    it("rejects a non-tapped permanent", () => {
        const state = setupUntapPick(1);
        // Manually untap land-0 to test rejection.
        state.players[0].battlefield.find((c) => c.id === "land-0")!.isTapped =
            false;
        const head = state.pendingChoices![0];

        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["land-0"],
            })
        ).toThrow(/not tapped/i);
    });

    it("rejects a permanent with does-not-untap", () => {
        const state = setupUntapPick(1);
        state.players[0].battlefield.find(
            (c) => c.id === "land-0"
        )!.staticAbilities = ["does-not-untap"];
        const head = state.pendingChoices![0];

        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["land-0"],
            })
        ).toThrow(/cannot untap/i);
    });

    it("rejects when card is not on battlefield", () => {
        const state = setupUntapPick(1);
        const head = state.pendingChoices![0];

        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["nonexistent"],
            })
        ).toThrow(/not on battlefield/i);
    });

    it("rejects count > max", () => {
        const state = setupUntapPick(3);
        const head = state.pendingChoices![0];

        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["land-0", "land-1"],
            })
        ).toThrow(/at most/i);
    });
});

describe("applyPendingChoiceSubmit — unsupported kinds", () => {
    it("throws for mulligan-bottom (handled by selectResolutionChoice until #84)", () => {
        const state = makeState({
            pendingChoices: [
                {
                    stackItemId: "",
                    step: 0,
                    choiceId: "bottom",
                    playerId: "p1",
                    kind: "mulligan-bottom",
                    zone: "hand",
                    count: 1,
                    selected: [],
                    prompt: "Bottom 1",
                },
            ],
        });

        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: "",
                step: 0,
                choiceId: "bottom",
                cardInstanceIds: [],
            })
        ).toThrow(/does not yet handle/i);
    });
});

describe("applyPendingChoiceSubmit — no pending choice", () => {
    it("throws when the queue is empty", () => {
        const state = makeState({});
        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: "",
                step: 0,
                choiceId: "x",
                cardInstanceIds: [],
            })
        ).toThrow(/no pending choice/i);
    });
});
