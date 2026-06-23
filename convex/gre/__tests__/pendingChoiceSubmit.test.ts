// Tests for the client-buffered submission helper (ADR 0007). Exercises
// the atomic validation + dispatch path that backs the
// `submitResolutionChoice` mutation. Slice #80 only handles `discard-hand`.

import { describe, it, expect } from "vitest";
import { resolveTopOfStack, type GameState, type StackItem } from "../state";
import { advancePhase, untapStep } from "../phases";
import { recordDeclaration, makeMulliganState } from "../mulligan";
import {
    applyPendingChoiceSubmit,
    applyNameCardSubmit,
    applyRandomRevealAck,
} from "../pendingChoiceSubmit";
import { checkStateBasedActions } from "../sba";
import {
    darkRitual,
    disruptingScepter,
    grizzlyBears,
    lightningBolt,
    mountain,
    plains,
    swamp,
    winterOrb,
    wordOfCommand,
} from "../../cards/sets/lea";
import { jasmineBoreal, petraSphinx, tundraWolves } from "../../cards/sets/leg";
import {
    bottleOfSuleiman,
    cuombajjWitches,
    juzamDjinn,
    ydwenEfreet,
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

// ---------------------------------------------------------------------------
// Block-trigger resume path (#303). Drives Ydwen Efreet end to end through the
// same backend mutation seam as Bottle, but via a triggered ability rather
// than an activated one: BLOCKERS_CONFIRMED trigger on the stack → suspend on a
// random-reveal flip → ack → remove-from-combat / unblock applied only on LOSE.
// ---------------------------------------------------------------------------

function suspendOnYdwenBlockFlip(seed: number): GameState {
    const attacker = makeInstance(grizzlyBears.id, {
        id: "atk",
        controllerId: "p1",
        ownerId: "p1",
        isAttacking: true,
    });
    const ydwen = makeInstance(ydwenEfreet.id, {
        id: "ydwen",
        controllerId: "p2",
        ownerId: "p2",
        isBlocking: true,
    });
    const state = makeState({
        rngSeed: seed,
        activePlayerId: "p1",
        players: [
            makePlayer("p1", { life: 20, battlefield: [attacker] }),
            makePlayer("p2", { life: 20, battlefield: [ydwen] }),
        ],
        combat: {
            attackerIds: ["atk"],
            confirmed: true,
            blockerAssignments: { ydwen: ["atk"] },
            blockedAttackerIds: ["atk"],
            blockersConfirmed: true,
        },
    });
    // Mirror the post-trigger state: triggered ability on the stack.
    state.stack.push({
        ...ydwen,
        zone: "stack",
        castById: "p2",
        triggeredAbilityId: "ydwen-efreet-block-flip",
        triggerSourceId: "ydwen",
        triggerEvent: {
            type: "BLOCKERS_CONFIRMED",
            attackerId: "atk",
            attackerControllerId: "p1",
            attackerTypes: ["Creature"],
            attackerSubtypes: [],
            blockerId: "ydwen",
            blockerControllerId: "p2",
            blockerTypes: ["Creature"],
            blockerSubtypes: ["Efreet"],
        } as StackItem["triggerEvent"],
        targets: [],
    });
    resolveTopOfStack(state);
    return state;
}

describe("applyRandomRevealAck — Ydwen block-trigger resume (#303, CR 705 / 509.1h)", () => {
    it("WIN: ack resumes and Ydwen stays blocking", () => {
        const state = suspendOnYdwenBlockFlip(WIN_SEED);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("random-reveal");
        expect(head.playerId).toBe("p2");
        // Consequence not applied while suspended.
        const before = state.players[1].battlefield.find(
            (c) => c.id === "ydwen"
        )!;
        expect(before.isBlocking).toBe(true);

        applyRandomRevealAck(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            choiceId: head.choiceId,
        });

        const y = state.players[1].battlefield.find((c) => c.id === "ydwen")!;
        expect(y.isBlocking).toBe(true);
        expect(y.cantBlockThisTurn).toBeFalsy();
        expect(state.combat!.blockedAttackerIds).toContain("atk");
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack.length).toBe(0);
    });

    it("LOSE: ack resumes, removes Ydwen from combat, unblocks the solely-blocked attacker", () => {
        const state = suspendOnYdwenBlockFlip(LOSE_SEED);
        const head = state.pendingChoices![0];
        // Still blocking while suspended.
        expect(
            state.players[1].battlefield.find((c) => c.id === "ydwen")!
                .isBlocking
        ).toBe(true);

        applyRandomRevealAck(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            choiceId: head.choiceId,
        });

        const y = state.players[1].battlefield.find((c) => c.id === "ydwen")!;
        expect(y.isBlocking).toBeFalsy();
        expect(y.cantBlockThisTurn).toBe(true);
        expect(state.combat!.blockedAttackerIds).not.toContain("atk");
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack.length).toBe(0);
    });
});

// Backend integration for the legend-rule keep-which choice (CR 704.5j, #378).
// `applyPendingChoiceSubmit` is the exact engine entry the `submitResolutionChoice`
// mutation calls (game.ts), so this exercises GRE → mutation surface → resolved
// state for an SBA-raised phase-level choice (stackItemId: "").
describe("applyPendingChoiceSubmit — legend-keep (CR 704.5j)", () => {
    function setupTwoJasmines(): GameState {
        const a = makeInstance(jasmineBoreal.id, {
            id: "jasmine-a",
            controllerId: "p1",
            ownerId: "p1",
        });
        const b = makeInstance(jasmineBoreal.id, {
            id: "jasmine-b",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a, b] }),
                makePlayer("p2"),
            ],
        });
        // The SBA enqueues the legend-keep prompt, mirroring the server flow.
        checkStateBasedActions(state);
        return state;
    }

    it("happy path: keeps the picked legend, the other goes to graveyard, queue clears", () => {
        const state = setupTwoJasmines();
        const head = state.pendingChoices![0];

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["jasmine-b"],
        });

        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "jasmine-b",
        ]);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
            "jasmine-a",
        ]);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("rejects a pick that is not one of the recorded duplicates", () => {
        const state = setupTwoJasmines();
        const head = state.pendingChoices![0];
        // A real-but-irrelevant battlefield id is not in candidateIds.
        const intruder = makeInstance(grizzlyBears.id, { id: "intruder" });
        state.players[0].battlefield.push(intruder);

        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["intruder"],
            })
        ).toThrow();
        // Choice still pending — nothing destroyed.
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.players[0].battlefield).toHaveLength(3);
    });

    it("rejects a submission from the wrong player (identity guard)", () => {
        const state = setupTwoJasmines();
        const head = state.pendingChoices![0];
        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p2",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["jasmine-a"],
            })
        ).toThrow();
        expect(state.pendingChoices).toHaveLength(1);
    });
});

describe("applyNameCardSubmit — name-a-card mid-resolution (CR 202.3 / 701.x)", () => {
    // Drives Petra Sphinx's {T} ability to suspend on a `name-card` head, then
    // exercises the dedicated submit path (the primitive the `submitNameCard`
    // mutation drives).
    function setupNameCard(): GameState {
        const top = makeInstance(tundraWolves.id, {
            id: "top",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const sphinx = makeInstance(petraSphinx.id, {
            id: "sphinx",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sphinx] }),
                makePlayer("p2", { library: [top] }),
            ],
        });
        const ability = petraSphinx.activatedAbilities![0];
        state.stack.push({
            ...sphinx,
            zone: "stack",
            castById: "p1",
            abilityId: ability.id,
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        return state;
    }

    it("happy path: commits the name and resumes resolution", () => {
        const state = setupNameCard();
        expect(state.pendingChoices![0].kind).toBe("name-card");
        applyNameCardSubmit(state, {
            playerId: "p2",
            cardName: "Tundra Wolves",
        });
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["top"]);
    });

    it("rejects a name not in the registry (CR 201.2)", () => {
        const state = setupNameCard();
        expect(() =>
            applyNameCardSubmit(state, {
                playerId: "p2",
                cardName: "No Such Card",
            })
        ).toThrow(/recognized/i);
        expect(state.pendingChoices).toHaveLength(1);
    });

    it("rejects a submission from the wrong player", () => {
        const state = setupNameCard();
        expect(() =>
            applyNameCardSubmit(state, {
                playerId: "p1",
                cardName: "Tundra Wolves",
            })
        ).toThrow(/your pending choice/i);
    });

    it("rejects an empty name", () => {
        const state = setupNameCard();
        expect(() =>
            applyNameCardSubmit(state, { playerId: "p2", cardName: "   " })
        ).toThrow();
        expect(state.pendingChoices).toHaveLength(1);
    });

    it("throws when the head is not a name-card choice", () => {
        const state = setupCleanupDiscard(STARTING_HAND_SIZE + 2);
        expect(() =>
            applyNameCardSubmit(state, {
                playerId: "p1",
                cardName: "Tundra Wolves",
            })
        ).toThrow(/not a name-card/i);
    });

    it("generic submit rejects a name-card head (routes to submitNameCard)", () => {
        const state = setupNameCard();
        const head = state.pendingChoices![0];
        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: head.playerId,
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["top"],
            })
        ).toThrow(/submitNameCard/i);
    });
});

// Backend integration for Word of Command's controlled cast (#577, ADR 0037):
// drives the EXACT path the `submitResolutionChoice` mutation runs
// (`applyPendingChoiceSubmit` → resolve replay → `checkStateBasedActions`),
// so the GRE → game.ts boundary is covered, not just the engine in isolation.
describe("Word of Command — submitResolutionChoice path (#577, CR 601)", () => {
    function wocState(opts: {
        oppHand: StackItem[] | ReturnType<typeof makeInstance>[];
        oppBattlefield?: ReturnType<typeof makeInstance>[];
    }): GameState {
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: opts.oppHand,
                    battlefield: opts.oppBattlefield ?? [],
                }),
            ],
        });
    }

    function submitViaMutationPath(state: GameState, pickId: string) {
        const head = (state.pendingChoices ?? [])[0];
        if (!head) throw new Error("no pending choice");
        // Mirror submitResolutionChoice's handler exactly.
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [pickId],
        });
        checkStateBasedActions(state);
    }

    it("casts the chosen non-targeted spell as the opponent's spell via the submit path", () => {
        const oppRitual = makeInstance(darkRitual.id, {
            id: "opp-ritual",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppSwamp = makeInstance(swamp.id, {
            id: "opp-swamp",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = wocState({
            oppHand: [oppRitual],
            oppBattlefield: [oppSwamp],
        });
        pushSpell(state, wordOfCommand.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);

        // The mutation's atomic submit path puts Dark Ritual on the stack.
        submitViaMutationPath(state, "opp-ritual");

        const ritual = state.stack.find(
            (s) => (s.card as { id?: string }).id === darkRitual.id
        );
        expect(ritual?.castById).toBe("p2");
        expect(ritual?.actingPlayerId).toBe("p1");
        expect(oppSwamp.isTapped).toBe(true);
    });

    it("rejects a stale submit for a different chooser (validation in the submit path)", () => {
        const oppRitual = makeInstance(darkRitual.id, {
            id: "opp-ritual",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = wocState({ oppHand: [oppRitual] });
        pushSpell(state, wordOfCommand.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);

        const head = (state.pendingChoices ?? [])[0];
        // The opponent (p2) is NOT the chooser — the controller (p1) is.
        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p2",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["opp-ritual"],
            })
        ).toThrow(/stale/i);
    });

    // --- Targeted spell branch (#578, CR 601.2c): the controller picks the
    // chosen spell's targets through the same submit path. ---

    it("casts the opponent's Lightning Bolt aimed at the opponent themselves via the submit path", () => {
        const oppBolt = makeInstance(lightningBolt.id, {
            id: "opp-bolt",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppMountain = makeInstance(mountain.id, {
            id: "opp-mountain",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = wocState({
            oppHand: [oppBolt],
            oppBattlefield: [oppMountain],
        });
        const startingLife = state.players[1].life;
        pushSpell(state, wordOfCommand.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);

        // 1) Pick the Bolt through the mutation's submit path.
        submitViaMutationPath(state, "opp-bolt");
        // A second choice — the target pick — is now routed to the controller.
        const head = (state.pendingChoices ?? [])[0];
        expect(head?.playerId).toBe("p1");
        expect(head?.kind).toBe("choose-damage-target");
        expect(head?.candidatePlayerIds).toEqual(
            expect.arrayContaining(["p1", "p2"])
        );

        // 2) Aim it at the opponent (p2) themselves through the submit path.
        submitViaMutationPath(state, "p2");

        const bolt = state.stack.find(
            (s) => (s.card as { id?: string }).id === lightningBolt.id
        );
        expect(bolt?.castById).toBe("p2"); // CR 601 — opponent's spell
        expect(bolt?.actingPlayerId).toBe("p1"); // ADR 0037
        expect(bolt?.targets).toEqual([{ type: "player", id: "p2" }]);
        expect(oppMountain.isTapped).toBe(true);

        // 3) Resolve: 3 damage lands on the opponent.
        resolveTopOfStack(state);
        checkStateBasedActions(state);
        expect(state.players[1].life).toBe(startingLife - 3);
    });

    it("rejects an illegal target pick (not in the legal set) via the submit path", () => {
        const oppBolt = makeInstance(lightningBolt.id, {
            id: "opp-bolt",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const oppMountain = makeInstance(mountain.id, {
            id: "opp-mountain",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = wocState({
            oppHand: [oppBolt],
            oppBattlefield: [oppMountain],
        });
        pushSpell(state, wordOfCommand.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        submitViaMutationPath(state, "opp-bolt");

        // "no-such-id" is neither a legal permanent nor a legal player target.
        const head = (state.pendingChoices ?? [])[0];
        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: head.playerId,
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["no-such-id"],
            })
        ).toThrow(/legal target/i);
    });
});
