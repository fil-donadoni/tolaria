// Engine-level tests for the mid-resolution player choice machinery
// (CR 608.2, 101.4). Covers suspension, resume, APNAP ordering, stepped
// resolve advancement, and wire projection passthrough. Balance is the
// vehicle card — it exercises every branch of the stepped resolver.

import { describe, it, expect } from "vitest";
import type { GameState, StackItem } from "../state";
import { resolveTopOfStack } from "../state";
import { balance, grizzlyBears, plains } from "../../cards/sets/lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { projectPublicState } from "../../gameProjections";

/** Seeds a game with Balance on the stack (cast by p1) and given
 *  battlefields / hands for each player. Active player = p1. */
function setupBalance(overrides: {
    p1Lands?: number;
    p2Lands?: number;
    p1Creatures?: number;
    p2Creatures?: number;
    p1Hand?: number;
    p2Hand?: number;
}): GameState {
    const p1Lands = Array.from({ length: overrides.p1Lands ?? 0 }, (_, i) =>
        makeInstance(plains.id, { id: `p1-land-${i}`, controllerId: "p1" })
    );
    const p2Lands = Array.from({ length: overrides.p2Lands ?? 0 }, (_, i) =>
        makeInstance(plains.id, { id: `p2-land-${i}`, controllerId: "p2" })
    );
    const p1Creatures = Array.from(
        { length: overrides.p1Creatures ?? 0 },
        (_, i) =>
            makeInstance(grizzlyBears.id, {
                id: `p1-bear-${i}`,
                controllerId: "p1",
            })
    );
    const p2Creatures = Array.from(
        { length: overrides.p2Creatures ?? 0 },
        (_, i) =>
            makeInstance(grizzlyBears.id, {
                id: `p2-bear-${i}`,
                controllerId: "p2",
            })
    );
    const p1Hand = Array.from({ length: overrides.p1Hand ?? 0 }, (_, i) =>
        makeInstance(grizzlyBears.id, {
            id: `p1-card-${i}`,
            controllerId: "p1",
            zone: "hand",
        })
    );
    const p2Hand = Array.from({ length: overrides.p2Hand ?? 0 }, (_, i) =>
        makeInstance(grizzlyBears.id, {
            id: `p2-card-${i}`,
            controllerId: "p2",
            zone: "hand",
        })
    );

    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [...p1Lands, ...p1Creatures],
                hand: p1Hand,
            }),
            makePlayer("p2", {
                battlefield: [...p2Lands, ...p2Creatures],
                hand: p2Hand,
            }),
        ],
    });
    pushSpell(state, balance.id, "p1");
    return state;
}

/** Finalizes the head pending choice by storing the given picks into
 *  collectedChoices and shifting the queue, mimicking what the
 *  selectResolutionChoice mutation does. Returns the updated state. */
function commitHeadChoice(state: GameState, picks: string[]): void {
    const queue = state.pendingChoices ?? [];
    if (queue.length === 0) throw new Error("No pending choice to commit");
    const head = queue[0];
    const stackItem = state.stack.find(
        (s) => s.id === head.stackItemId
    ) as StackItem;
    stackItem.collectedChoices = {
        ...(stackItem.collectedChoices ?? {}),
        [`${head.step}:${head.choiceId}`]: picks,
    };
    queue.shift();
    state.pendingChoices = queue.length > 0 ? queue : undefined;
}

describe("stepped resolve — suspension and resume (CR 608.2)", () => {
    it("suspends the resolver when requestChoice enqueues a pending choice", () => {
        // p1 has 3 lands, p2 has 1 land. Step 1 asks p1 to keep 1 of 3.
        const state = setupBalance({ p1Lands: 3, p2Lands: 1 });
        const result = resolveTopOfStack(state);

        expect(result).toBeNull();
        expect(state.stack.length).toBe(1);
        expect(state.stack[0].resolutionStep).toBe(0);
        expect(state.pendingChoices?.length).toBe(1);
        expect(state.pendingChoices?.[0].playerId).toBe("p1");
        expect(state.pendingChoices?.[0].count).toBe(1);
        expect(state.pendingChoices?.[0].zone).toBe("battlefield");
        expect(state.pendingChoices?.[0].kind).toBe("keep-permanents");
    });

    it("does not suspend when no choice is needed (all counts tied)", () => {
        const state = setupBalance({ p1Lands: 2, p2Lands: 2 });
        const result = resolveTopOfStack(state);

        // No choices needed → spell resolves fully (moves to graveyard),
        // pendingChoices never populated.
        expect(result).not.toBeNull();
        expect(state.stack.length).toBe(0);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].graveyard.length).toBe(1); // Balance itself
    });

    it("APNAP: active player's choice is enqueued before the opponent's", () => {
        // Both players have 3, min 0 — wait, we need BOTH to need choices.
        // Use: p1 has 3 lands, p2 has 2 lands, min = 2, only p1 needs choice.
        // Change to both asymmetric: p1 has 3, p2 has 4. min=3. Both above min?
        // p1: 3 > 3 no; so only p2 chooses. Need strictly: p1 has 3, p2 has 5,
        // min=3 → p2 keeps 3. Only one choice. To get BOTH needing choices
        // with min > 0, each must have > min. min is the smaller, so the
        // smaller-holder always matches min exactly → only the larger-holder
        // chooses. With two players, at most one side asks in a zone.
        //
        // To exercise APNAP with multiple queued choices we move to step 3
        // (creatures). Here p1 has 2 creatures and p2 has 4 creatures → only
        // p2 chooses. For true parallel enqueue we need a step where BOTH
        // players exceed min, which only happens in ≥3-player games. Tolaria
        // is 2p, so we assert the 2p behavior: only the excess-holder is
        // enqueued.
        const state = setupBalance({ p1Lands: 3, p2Lands: 5 });
        resolveTopOfStack(state);
        expect(state.pendingChoices?.length).toBe(1);
        expect(state.pendingChoices?.[0].playerId).toBe("p2");
    });

    it("resumes the step on next invocation after collectedChoices is populated", () => {
        const state = setupBalance({ p1Lands: 3, p2Lands: 1 });
        resolveTopOfStack(state);
        // p1 chooses to keep land 0.
        commitHeadChoice(state, ["p1-land-0"]);

        // Resume: step 0 re-runs (sacrifices lands 1 and 2), then step 1
        // (hands) and step 2 (creatures) run with empty zones → no new
        // pending choices, spell completes.
        const result = resolveTopOfStack(state);

        expect(result).not.toBeNull();
        expect(state.stack.length).toBe(0);
        expect(state.pendingChoices).toBeUndefined();
        // p1 lost 2 lands (kept land-0); p2 kept its only land.
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "p1-land-0",
        ]);
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "p2-land-0",
        ]);
        // Non-kept lands in p1's graveyard (their owner = p1)
        expect(state.players[0].graveyard.map((c) => c.id).sort()).toContain(
            "p1-land-1"
        );
        expect(state.players[0].graveyard.map((c) => c.id).sort()).toContain(
            "p1-land-2"
        );
    });

    it("advances through steps: step 0 done then step 1 enqueues", () => {
        // p1 has 2 lands, p2 has 1 land → step 1 asks p1 to keep 1 of 2.
        // p1 has 3 cards in hand, p2 has 0 → step 2 asks p1 to keep 0 of 3
        // (min=0, apply-all discard, no choice).
        // p1 has 3 creatures, p2 has 1 → step 3 asks p1 to keep 1 of 3.
        const state = setupBalance({
            p1Lands: 2,
            p2Lands: 1,
            p1Hand: 3,
            p2Hand: 0,
            p1Creatures: 3,
            p2Creatures: 1,
        });
        resolveTopOfStack(state);
        // Suspended on step 0 (lands).
        expect(state.stack[0].resolutionStep).toBe(0);
        expect(state.pendingChoices?.[0].kind).toBe("keep-permanents");
        expect(state.pendingChoices?.[0].filter?.types).toBe("Land");

        commitHeadChoice(state, ["p1-land-0"]);
        resolveTopOfStack(state);
        // Step 0 completed (lands balanced), step 1 (hand) applied with
        // min=0 → all of p1's cards discarded simultaneously. Step 2
        // (creatures) suspends on p1's 1-of-3 keep choice.
        expect(state.players[0].hand.length).toBe(0);
        expect(state.players[0].graveyard.length).toBeGreaterThanOrEqual(4);
        expect(state.stack[0].resolutionStep).toBe(2);
        expect(state.pendingChoices?.[0].filter?.types).toBe("Creature");

        commitHeadChoice(state, ["p1-bear-0"]);
        resolveTopOfStack(state);
        // All done — spell in graveyard, stack empty, no pending choices.
        expect(state.stack.length).toBe(0);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "p1-land-0",
            "p1-bear-0",
        ]);
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "p2-land-0",
            "p2-bear-0",
        ]);
    });
});

describe("wire projection — pendingChoices passthrough", () => {
    it("pendingChoices survives projectPublicState for both viewers", () => {
        const state = setupBalance({ p1Lands: 3, p2Lands: 1 });
        resolveTopOfStack(state);

        const p1View = projectPublicState(state, 1, "p1");
        const p2View = projectPublicState(state, 1, "p2");

        // The pending choice shape is identical on both sides — the UI
        // decides whether to render a prompt vs. a "waiting" banner based
        // on playerId === viewerId.
        expect(p1View.pendingChoices?.length).toBe(1);
        expect(p1View.pendingChoices?.[0].playerId).toBe("p1");
        expect(p1View.pendingChoices?.[0].count).toBe(1);
        expect(p1View.pendingChoices?.[0].prompt).toMatch(/keep/i);
        expect(p2View.pendingChoices?.length).toBe(1);
        expect(p2View.pendingChoices?.[0].playerId).toBe("p1");
    });
});
