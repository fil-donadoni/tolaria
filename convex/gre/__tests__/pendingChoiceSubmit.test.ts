// Tests for the client-buffered submission helper (ADR 0007). Exercises
// the atomic validation + dispatch path that backs the
// `submitResolutionChoice` mutation. Slice #80 only handles `discard-hand`.

import { describe, it, expect } from "vitest";
import { resolveTopOfStack, type GameState } from "../state";
import { advancePhase, untapStep } from "../phases";
import { recordDeclaration, makeMulliganState } from "../mulligan";
import {
    applyPendingChoiceSubmit,
    applyRandomRevealAck,
} from "../pendingChoiceSubmit";
import {
    disruptingScepter,
    grizzlyBears,
    lightningBolt,
    plains,
    winterOrb,
} from "../../cards/sets/lea";
import {
    bottleOfSuleiman,
    cuombajjWitches,
    juzamDjinn,
} from "../../cards/sets/arn";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";

const STARTING_HAND_SIZE = 7;

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

// ---------------------------------------------------------------------------
// mulligan-bottom (CR 103.5) — London mulligan bottoming
// ---------------------------------------------------------------------------

function makeMulliganGame(): GameState {
    const deckSize = 60;
    function deck(owner: string) {
        return Array.from({ length: deckSize }, (_, i) =>
            makeInstance(grizzlyBears.id, {
                id: `${owner}-lib-${i}`,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );
    }
    const state = makeState({
        phase: "MULLIGAN",
        players: [
            makePlayer("p1", { library: deck("p1") }),
            makePlayer("p2", { library: deck("p2") }),
        ],
    });
    state.mulligan = makeMulliganState(state);
    return state;
}

describe("applyPendingChoiceSubmit — mulligan-bottom (CR 103.5)", () => {
    it("happy path: bottoms the chosen cards and advances to UPKEEP", () => {
        const state = makeMulliganGame();
        recordDeclaration(state, "p1", "mull");
        recordDeclaration(state, "p2", "keep");
        recordDeclaration(state, "p1", "keep");

        expect(state.pendingChoices).toHaveLength(1);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("mulligan-bottom");
        expect(head.count).toBe(1);

        const pickedId = state.players[0].hand[0].id;

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [pickedId],
        });

        expect(state.mulligan).toBeUndefined();
        expect(state.phase).toBe("UPKEEP");
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].hand).toHaveLength(STARTING_HAND_SIZE - 1);
        expect(
            state.players[0].library[state.players[0].library.length - 1].id
        ).toBe(pickedId);
    });

    it("rejects card not in hand", () => {
        const state = makeMulliganGame();
        recordDeclaration(state, "p1", "mull");
        recordDeclaration(state, "p2", "keep");
        recordDeclaration(state, "p1", "keep");
        const head = state.pendingChoices![0];

        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["nonexistent"],
            })
        ).toThrow(/not in hand/i);
    });

    it("rejects wrong count", () => {
        const state = makeMulliganGame();
        recordDeclaration(state, "p1", "mull");
        recordDeclaration(state, "p2", "keep");
        recordDeclaration(state, "p1", "keep");
        const head = state.pendingChoices![0];
        expect(head.count).toBe(1);

        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: [],
            })
        ).toThrow(/at least/i);
    });
});

describe("applyPendingChoiceSubmit — may-pay rejected", () => {
    it("throws for may-pay (use submitMayPay instead)", () => {
        const state = makeState({
            pendingChoices: [
                {
                    stackItemId: "s1",
                    step: 0,
                    choiceId: "p1",
                    playerId: "p1",
                    kind: "may-pay",
                    count: 1,
                    prompt: "Pay?",
                },
            ],
        });

        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: "s1",
                step: 0,
                choiceId: "p1",
                cardInstanceIds: [],
            })
        ).toThrow(/submitMayPay/i);
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

// Backend submission path for the opponent-chosen "any target" choice
// (Cuombajj Witches). Exercises `applyPendingChoiceSubmit` for the
// `choose-damage-target` kind: it validates against the permanent/player
// allow-lists rather than the zone-membership check, then resumes the
// suspended resolve so the second ping lands.
describe("applyPendingChoiceSubmit — choose-damage-target (Cuombajj Witches)", () => {
    /** Push the Witches ability on the stack with the controller's ping-1
     *  target already chosen, resolve once to suspend on the opponent's
     *  choice, and return the suspended state + the head choice. */
    function suspendOnOpponentChoice() {
        const witches = makeInstance(cuombajjWitches.id, {
            id: "witches",
            controllerId: "p1",
        });
        const myBody = makeInstance(juzamDjinn.id, {
            id: "p1-body",
            controllerId: "p1",
        });
        const oppBody = makeInstance(juzamDjinn.id, {
            id: "p2-body",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [witches, myBody] }),
                makePlayer("p2", { battlefield: [oppBody] }),
            ],
        });
        state.stack.push({
            ...witches,
            zone: "stack",
            castById: "p1",
            abilityId: "cuombajj-witches-pings",
            targets: [{ type: "permanent", id: "p2-body" }],
        });
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        return { state, head };
    }

    it("accepts a player pick and resumes to land both pings", () => {
        const { state, head } = suspendOnOpponentChoice();
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["p1"], // opponent pings the controller
        });
        expect(state.players[0].life).toBe(19); // ping 2 → p1
        expect(
            state.players[1].battlefield.find((c) => c.id === "p2-body")!
                .damageMarked
        ).toBe(1); // ping 1 → p2's body
        expect(state.pendingChoices ?? []).toEqual([]);
        expect(state.stack).toEqual([]);
    });

    it("accepts a damageable-permanent pick and resumes", () => {
        const { state, head } = suspendOnOpponentChoice();
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["p1-body"], // opponent pings controller's body
        });
        expect(
            state.players[0].battlefield.find((c) => c.id === "p1-body")!
                .damageMarked
        ).toBe(1);
        expect(state.pendingChoices ?? []).toEqual([]);
    });

    it("rejects an id that is neither a legal permanent nor a player", () => {
        const { state, head } = suspendOnOpponentChoice();
        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p2",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["does-not-exist"],
            })
        ).toThrow(/not a legal target/i);
    });

    it("rejects a submission from the wrong player (controller can't choose)", () => {
        const { state, head } = suspendOnOpponentChoice();
        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p1", // the controller, not the chooser
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["p2-body"],
            })
        ).toThrow(/stale pending choice/i);
    });
});

// ---------------------------------------------------------------------------
// applyRandomRevealAck — backend resume path for an engine-drawn coin flip
// (CR 705.2 / ADR 0023). Mirrors the `submitRandomRevealAck` mutation, which is
// a thin wrapper over this helper. Drives Bottle of Suleiman end to end:
// activate → suspend on a random-reveal choice → ack → consequence applied.
// ---------------------------------------------------------------------------

const WIN_SEED = 1; // first flipCoin() → true (heads / win)
const LOSE_SEED = 7; // first flipCoin() → false (tails / lose)

function suspendOnBottleFlip(seed: number): GameState {
    const bottle = makeInstance(bottleOfSuleiman.id, {
        id: "bottle",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        rngSeed: seed,
        players: [
            makePlayer("p1", { life: 20, battlefield: [bottle] }),
            makePlayer("p2"),
        ],
    });
    // Mirror the post-activate state: ability on the stack, cost paid.
    state.stack.push({
        ...bottle,
        zone: "stack",
        castById: "p1",
        abilityId: "bottle-of-suleiman-flip",
        targets: [],
    });
    resolveTopOfStack(state);
    return state;
}

describe("applyRandomRevealAck — coin flip resume (CR 705.2 / ADR 0023)", () => {
    it("WIN: ack resumes resolution and creates the 5/5 flying Djinn token", () => {
        const state = suspendOnBottleFlip(WIN_SEED);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("random-reveal");
        // Consequence not yet applied while suspended.
        expect(state.players[0].battlefield.some((c) => c.isToken)).toBe(false);

        applyRandomRevealAck(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            choiceId: head.choiceId,
        });

        const tokens = state.players[0].battlefield.filter((c) => c.isToken);
        expect(tokens).toHaveLength(1);
        expect(tokens[0].power).toBe(5);
        expect(tokens[0].staticAbilities).toContain("flying");
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack.length).toBe(0);
    });

    it("LOSE: ack resumes resolution and deals 5 damage to the controller", () => {
        const state = suspendOnBottleFlip(LOSE_SEED);
        const head = state.pendingChoices![0];
        expect(state.players[0].life).toBe(20);

        applyRandomRevealAck(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            choiceId: head.choiceId,
        });

        expect(state.players[0].life).toBe(15);
        expect(state.players[0].battlefield.some((c) => c.isToken)).toBe(false);
        expect(state.pendingChoices).toBeUndefined();
    });

    it("throws when the head is not a random-reveal", () => {
        const state = makeState();
        expect(() =>
            applyRandomRevealAck(state, {
                playerId: "p1",
                stackItemId: "x",
                choiceId: "y",
            })
        ).toThrow(/no pending choice/i);
    });

    it("throws on a choice-id mismatch (stale ack)", () => {
        const state = suspendOnBottleFlip(WIN_SEED);
        const head = state.pendingChoices![0];
        expect(() =>
            applyRandomRevealAck(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                choiceId: "stale",
            })
        ).toThrow(/choice id mismatch/i);
    });
});
