// The choice-node contract (PRD #1423, issue #1425): a live `PendingChoice` is
// an in-tree ISMCTS decision node. This file unit-tests the reusable contract
// every choice kind plugs into — the per-kind `candidates()` generator, the
// pluggable `priorFor` seam, top-K + first-play-urgency opening, and stable
// identity keys — plus the three traversal seams (`decidingPlayer`,
// `enumerateMoves`, `applyMoveInSearch`) for the yes/no family.

import { describe, it, expect, afterEach } from "vitest";
import type { GameState, PendingChoice } from "../state";
import type { MayPayCost } from "../../cards/types";

/** A fixed-cardinal sacrifice leg (CR 701.16b) over creatures. */
const SAC_ONE_CREATURE: MayPayCost = {
    sacrifice: { count: 1, filter: { types: ["Creature"] } },
};
import { decidingPlayer, applyMoveInSearch } from "../search";
import { enumerateMoves } from "../moves";
import {
    CHOICE_CANDIDATE_GENERATORS,
    CHOICE_TOP_K,
    choiceCandidates,
    hasChoiceCandidateGenerator,
    selectOpeningCandidate,
    stableCardIdentity,
    stableSetIdentity,
    topKByPrior,
    type ChoiceCandidate,
} from "../ai/choiceCandidates";
import {
    heuristicChoicePrior,
    priorFor,
    resetChoicePriorFn,
    setChoicePriorFn,
} from "../ai/choicePriors";
import {
    makeState,
    makePlayer,
    makeInstance,
} from "../../cards/__tests__/setup";
import { grizzlyBears } from "../../cards/sets/lea/green";

afterEach(() => resetChoicePriorFn());

/** A board with `bearIds` Grizzly Bears for p1, and a head pending choice. */
function stateWithChoice(
    choice: Partial<PendingChoice> & Pick<PendingChoice, "kind">,
    bearIds: string[] = []
): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: bearIds.map((id) =>
                    makeInstance(grizzlyBears.id, {
                        id,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "battlefield",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
        priorityPlayerId: "p1",
        activePlayerId: "p1",
    });
    state.pendingChoices = [
        {
            stackItemId: "stack-1",
            step: 0,
            choiceId: "c1",
            playerId: "p1",
            count: 1,
            prompt: "test choice",
            ...choice,
        } as PendingChoice,
    ];
    return state;
}

describe("choice-node candidate contract (CR 608.2 / ADR 0016, issue #1425)", () => {
    it("registers the yes/no family (may-pay, land-entry, draw-replacement)", () => {
        expect(hasChoiceCandidateGenerator("may-pay")).toBe(true);
        expect(hasChoiceCandidateGenerator("land-entry-tapped")).toBe(true);
        expect(hasChoiceCandidateGenerator("draw-replacement")).toBe(true);
        // A kind outside tranche 1 is NOT an in-tree node yet — additive by
        // design: no generator means the historical no-decision behavior.
        expect(hasChoiceCandidateGenerator("discard-hand")).toBe(false);
        expect(Object.keys(CHOICE_CANDIDATE_GENERATORS).length).toBe(3);
    });

    it("may-pay (CR 117.3a): a cost-less choice offers both answers", () => {
        const state = stateWithChoice({ kind: "may-pay" });
        const cands = choiceCandidates(state, state.pendingChoices![0]);
        expect(cands.map((c) => c.key).sort()).toEqual([
            "may-pay:no",
            "may-pay:yes",
        ]);
    });

    it("may-pay (CR 118.4): an UNAFFORDABLE cost self-prunes to the decline", () => {
        const state = stateWithChoice({ kind: "may-pay", cost: { life: 99 } });
        const cands = choiceCandidates(state, state.pendingChoices![0]);
        expect(cands.map((c) => c.key)).toEqual(["may-pay:no"]);
    });

    it("may-pay (CR 701.16b): a fixed sacrifice leg offers a worst-first victim set", () => {
        const state = stateWithChoice(
            {
                kind: "may-pay",
                cost: SAC_ONE_CREATURE,
            },
            ["bear-a", "bear-b"]
        );
        const cands = choiceCandidates(state, state.pendingChoices![0]);
        const accept = cands.find((c) => c.key.startsWith("may-pay:yes"));
        expect(accept).toBeDefined();
        // Keyed by CARD IDENTITY, never the instance id.
        expect(accept!.key).toBe("may-pay:yes|sac=Grizzly Bears");
        expect(accept!.key).not.toContain("bear-");
        expect(accept!.move).toMatchObject({ kind: "may-pay", accept: true });
        // Giving up material is reported to the prior seam.
        expect(accept!.hint?.materialGivenUp).toBeGreaterThan(0);
    });

    it("candidate keys are STABLE across determinizations (not per-world ids)", () => {
        const cost = SAC_ONE_CREATURE;
        const worldA = stateWithChoice({ kind: "may-pay", cost }, [
            "bear-a",
            "bear-b",
        ]);
        const worldB = stateWithChoice({ kind: "may-pay", cost }, [
            "utterly-different-instance-id",
            "another-world-id",
        ]);
        const keysA = choiceCandidates(worldA, worldA.pendingChoices![0]).map(
            (c) => c.key
        );
        const keysB = choiceCandidates(worldB, worldB.pendingChoices![0]).map(
            (c) => c.key
        );
        expect(keysA).toEqual(keysB);
        // …while the MOVE still names this world's instance.
        const acceptB = choiceCandidates(
            worldB,
            worldB.pendingChoices![0]
        ).find((c) => c.key.includes("sac="))!;
        expect(acceptB.move).toMatchObject({
            sacrificeIds: ["utterly-different-instance-id"],
        });
    });

    it("stable identity: definition name, and a count-aware multiset for a set", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "x",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        expect(stableCardIdentity(bear)).toBe("Grizzly Bears");
        expect(stableSetIdentity([bear, { ...bear, id: "y" }])).toBe(
            "Grizzly Bears x2"
        );
    });

    it("land-entry-tapped (CR 614.12 / ADR 0051): both answers when the life is payable", () => {
        const payable = stateWithChoice({
            kind: "land-entry-tapped",
            cost: { life: 2 },
            landInstanceId: "land-1",
        });
        expect(
            choiceCandidates(payable, payable.pendingChoices![0]).map(
                (c) => c.key
            )
        ).toEqual(["land-entry:yes", "land-entry:no"]);

        const unpayable = stateWithChoice({
            kind: "land-entry-tapped",
            cost: { life: 999 },
            landInstanceId: "land-1",
        });
        expect(
            choiceCandidates(unpayable, unpayable.pendingChoices![0]).map(
                (c) => c.key
            )
        ).toEqual(["land-entry:no"]);
    });

    it("draw-replacement (CR 614 / ADR 0061): declining outranks paying life for an unknown card", () => {
        const state = stateWithChoice({
            kind: "draw-replacement",
            cost: { life: 2 },
        });
        const cands = choiceCandidates(state, state.pendingChoices![0]);
        // Top-K ordering IS the prior ordering — brain.ts's policy is to decline.
        expect(cands[0].key).toBe("draw-replacement:no");
        expect(cands.map((c) => c.key)).toContain("draw-replacement:yes");
    });
});

describe("priorFor seam (issue #1425)", () => {
    const choice = (kind: PendingChoice["kind"]) =>
        stateWithChoice({ kind, cost: { life: 2 } });

    it("the v1 heuristic mirrors brain.ts's choice policy", () => {
        const mayPay = choice("may-pay");
        const head = mayPay.pendingChoices![0];
        const free = heuristicChoicePrior(mayPay, head, {
            key: "k",
            move: { kind: "may-pay", accept: true },
            hint: {},
        });
        const costly = heuristicChoicePrior(mayPay, head, {
            key: "k",
            move: { kind: "may-pay", accept: true },
            hint: { materialGivenUp: 500 },
        });
        // Accepting a cheap cost outranks accepting one that gives up a board.
        expect(free).toBeGreaterThan(costly);
    });

    it("is pluggable: an installed provider drives candidate ordering", () => {
        const state = choice("draw-replacement");
        const head = state.pendingChoices![0];
        // Default provider: decline first.
        expect(choiceCandidates(state, head)[0].key).toBe(
            "draw-replacement:no"
        );

        const previous = setChoicePriorFn((_s, _c, cand) =>
            cand.key.endsWith(":yes") ? 1 : 0
        );
        expect(choiceCandidates(state, head)[0].key).toBe(
            "draw-replacement:yes"
        );
        expect(
            priorFor(state, head, {
                key: "anything:yes",
                move: { kind: "draw-replacement", accept: true },
            })
        ).toBe(1);

        setChoicePriorFn(previous);
        expect(choiceCandidates(state, head)[0].key).toBe(
            "draw-replacement:no"
        );
    });
});

describe("bounded opening: top-K + first-play urgency (issue #1425)", () => {
    const cand = (key: string, prior: number): ChoiceCandidate => ({
        key,
        prior,
        move: { kind: "may-pay", accept: true },
    });

    it("topKByPrior keeps the highest priors, ties in generator order", () => {
        const picked = topKByPrior(
            [cand("a", 0.1), cand("b", 0.9), cand("c", 0.9), cand("d", 0.5)],
            3
        );
        expect(picked.map((c) => c.key)).toEqual(["b", "c", "d"]);
    });

    it("a choice node never opens more than CHOICE_TOP_K branches", () => {
        const many = Array.from({ length: 40 }, (_, i) =>
            cand(`k${i}`, i / 40)
        );
        expect(topKByPrior(many).length).toBe(CHOICE_TOP_K);
    });

    it("first-play urgency opens the highest-prior unopened candidate", () => {
        const pick = selectOpeningCandidate(
            [cand("low", 0.2), cand("high", 0.8), cand("mid", 0.5)],
            () => 0
        );
        expect(pick!.key).toBe("high");
    });

    it("falls back to uniform-random opening when no candidate carries a prior", () => {
        const pool = [cand("a", 0), cand("b", 0), cand("c", 0)];
        expect(selectOpeningCandidate(pool, () => 0.99)!.key).toBe("c");
        expect(selectOpeningCandidate(pool, () => 0)!.key).toBe("a");
        expect(selectOpeningCandidate([], () => 0)).toBeNull();
    });
});

describe("choice-node traversal seams (issue #1425)", () => {
    it("decidingPlayer returns the queue head's chooser (CR 101.4 APNAP at enqueue)", () => {
        const state = stateWithChoice({ kind: "may-pay", playerId: "p2" });
        expect(decidingPlayer(state)).toBe("p2");
    });

    it("decidingPlayer stays null for a choice kind with no generator", () => {
        const state = stateWithChoice({ kind: "discard-hand", zone: "hand" });
        expect(decidingPlayer(state)).toBeNull();
        expect(enumerateMoves(state, "p1")).toEqual([]);
    });

    it("enumerateMoves offers the choice's answers to the chooser ONLY", () => {
        const state = stateWithChoice({ kind: "may-pay" });
        expect(enumerateMoves(state, "p1").map((m) => m.kind)).toEqual([
            "may-pay",
            "may-pay",
        ]);
        expect(enumerateMoves(state, "p2")).toEqual([]);
    });

    it("applyMoveInSearch resolves a land-entry answer through the real resolver", () => {
        // CR 614.12 / ADR 0051 — the stackless shock-land choice: applying the
        // decline must clear the queue and resume the game (past the node).
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(grizzlyBears.id, {
                            id: "land-1",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
            priorityPlayerId: "p1",
            activePlayerId: "p1",
        });
        state.pendingChoices = [
            {
                stackItemId: "",
                step: 0,
                choiceId: "land-entry-1",
                playerId: "p1",
                kind: "land-entry-tapped",
                landInstanceId: "land-1",
                cost: { life: 2 },
                count: 1,
                prompt: "Pay 2 life?",
            },
        ];
        expect(decidingPlayer(state)).toBe("p1");
        applyMoveInSearch(state, "p1", { kind: "land-entry", accept: false });
        expect(state.pendingChoices?.length ?? 0).toBe(0);
        expect(state.priorityPlayerId).toBe("p1");
    });
});
