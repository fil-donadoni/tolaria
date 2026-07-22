// The choice-node contract (PRD #1423, issue #1425): a live `PendingChoice` is
// an in-tree ISMCTS decision node. This file unit-tests the reusable contract
// every choice kind plugs into — the per-kind `candidates()` generator, the
// pluggable `priorFor` seam, top-K + first-play-urgency opening, and stable
// identity keys — plus the three traversal seams (`decidingPlayer`,
// `enumerateMoves`, `applyMoveInSearch`) for the yes/no family and the
// modal `option-pick` generator (issue #1428).

import { describe, it, expect, afterEach } from "vitest";
import type { GameState, PendingChoice } from "../state";
import { resolveTopOfStack } from "../state";
import type { CardDefinition, EffectOp, MayPayCost } from "../../cards/types";
import { registerTokenDefinition } from "../../cards";

/** A fixed-cardinal sacrifice leg (CR 701.16b) over creatures. */
const SAC_ONE_CREATURE: MayPayCost = {
    sacrifice: { count: 1, filter: { types: ["Creature"] } },
};
import { decidingPlayer, applyMoveInSearch, searchWithTrace } from "../search";
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
    pushSpell,
} from "../../cards/__tests__/setup";
import { grizzlyBears } from "../../cards/sets/lea/green";

afterEach(() => resetChoicePriorFn());

/** Registers a synthetic DSL-only modal sorcery under a stable test id
 *  (mirrors `interpreter.test.ts`'s `registerScript` helper). Test-only ids
 *  never enter `getAllCards()`, so the catalogue sweep stays clean. */
function registerModalScript(id: string, effects: EffectOp[]): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        effects,
    } as CardDefinition);
    return id;
}

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
    it("registers the yes/no family + option-pick (may-pay, land-entry, draw-replacement, option-pick)", () => {
        expect(hasChoiceCandidateGenerator("may-pay")).toBe(true);
        expect(hasChoiceCandidateGenerator("land-entry-tapped")).toBe(true);
        expect(hasChoiceCandidateGenerator("draw-replacement")).toBe(true);
        expect(hasChoiceCandidateGenerator("option-pick")).toBe(true);
        // A kind outside these tranches is NOT an in-tree node yet — additive
        // by design: no generator means the historical no-decision behavior.
        expect(hasChoiceCandidateGenerator("discard-hand")).toBe(false);
        expect(Object.keys(CHOICE_CANDIDATE_GENERATORS).length).toBe(4);
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

    it("option-pick (CR 700.2 / 601.2b): one candidate per legal mode, top-K", () => {
        const state = stateWithChoice({
            kind: "option-pick",
            options: [
                { id: "kill", label: "Target opponent loses 5 life" },
                { id: "gain", label: "You gain 5 life" },
            ],
        });
        const cands = choiceCandidates(state, state.pendingChoices![0]);
        expect(cands.map((c) => c.key).sort()).toEqual([
            "option-pick:gain",
            "option-pick:kill",
        ]);
        const kill = cands.find((c) => c.key === "option-pick:kill")!;
        expect(kill.move).toMatchObject({
            kind: "resolution-choice",
            stackItemId: "stack-1",
            step: 0,
            choiceId: "c1",
            cardInstanceIds: ["kill"],
        });
    });

    it("option-pick: a SINGLE surviving option still yields one candidate (top-K never over-prunes)", () => {
        const state = stateWithChoice({
            kind: "option-pick",
            options: [{ id: "only", label: "The only mode" }],
        });
        const cands = choiceCandidates(state, state.pendingChoices![0]);
        expect(cands.map((c) => c.key)).toEqual(["option-pick:only"]);
    });

    it("option-pick keys are STABLE across determinizations (mode id is definition-level, not per-world)", () => {
        // A modal spell's option list is author-supplied per the card
        // DEFINITION, so it never varies by world in the first place — but the
        // key must still be the semantic mode id, never anything instance-ish.
        const state = stateWithChoice({
            kind: "option-pick",
            options: [
                { id: "kill", label: "Target opponent loses 5 life" },
                { id: "gain", label: "You gain 5 life" },
            ],
        });
        const keys = choiceCandidates(state, state.pendingChoices![0]).map(
            (c) => c.key
        );
        expect(keys.sort()).toEqual(["option-pick:gain", "option-pick:kill"]);
        expect(keys.every((k) => !/\d{2,}/.test(k))).toBe(true); // no instance-id-shaped key
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

    it("applyMoveInSearch resolves an option-pick (modal) answer through the real resolver (issue #1428)", () => {
        // A live modal spell mid-resolution: the `optionChoice` Op suspended on
        // an `option-pick` choice. Applying a `resolution-choice` candidate move
        // must run the CHOSEN mode's effects only, and resume past the node —
        // mirroring the yes/no family's `land-entry` traversal test above.
        const id = registerModalScript("test-1428-option-pick-traversal", [
            {
                op: "optionChoice",
                prompt: "Choose one.",
                modes: [
                    {
                        id: "gain",
                        label: "You gain 5 life",
                        effects: [
                            { op: "gainLife", player: "controller", amount: 5 },
                        ],
                    },
                    {
                        id: "kill",
                        label: "Target opponent loses 5 life",
                        effects: [
                            { op: "loseLife", player: "opponent", amount: 5 },
                        ],
                    },
                ],
            },
        ]);
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            priorityPlayerId: "p1",
            activePlayerId: "p1",
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the pick
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("option-pick");
        expect(decidingPlayer(state)).toBe("p1");

        applyMoveInSearch(state, "p1", {
            kind: "resolution-choice",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["kill"],
        });

        expect(state.players[1].life).toBe(15); // the "kill" mode ran
        expect(state.players[0].life).toBe(20); // the "gain" mode did NOT run
        expect(state.pendingChoices?.length ?? 0).toBe(0);
        expect(state.stack).toHaveLength(0);
    });
});

describe("option-pick playout: searchWithTrace picks a sensible mode (issue #1428)", () => {
    it("picks the LETHAL mode over the useless one on a targeted position", () => {
        // p2 is at 3 life: the "kill" mode (lose 5) wins the game outright, the
        // "gain" mode does nothing relevant. Search must find and prefer the
        // lethal mode once the choice node is live — mirroring `search.test.ts`'s
        // "burns the opponent's face for the kill" shape, but for a MODE pick
        // instead of a target pick.
        const id = registerModalScript("test-1428-option-pick-playout", [
            {
                op: "optionChoice",
                prompt: "Choose one.",
                modes: [
                    {
                        id: "gain",
                        label: "You gain 1 life",
                        effects: [
                            { op: "gainLife", player: "controller", amount: 1 },
                        ],
                    },
                    {
                        id: "kill",
                        label: "Target opponent loses 5 life",
                        effects: [
                            { op: "loseLife", player: "opponent", amount: 5 },
                        ],
                    },
                ],
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { life: 3 }),
            ],
            priorityPlayerId: "p1",
            activePlayerId: "p1",
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the pick
        expect(decidingPlayer(state)).toBe("p1");

        const { move } = searchWithTrace(state, "p1", { iterations: 200 }, 7);
        expect(move?.kind).toBe("resolution-choice");
        if (move?.kind !== "resolution-choice") throw new Error("kind");
        expect(move.cardInstanceIds).toEqual(["kill"]);
    });
});
