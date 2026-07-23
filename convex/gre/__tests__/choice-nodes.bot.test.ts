// The choice-node contract (PRD #1423, issue #1425): a live `PendingChoice` is
// an in-tree ISMCTS decision node. This file unit-tests the reusable contract
// every choice kind plugs into — the per-kind `candidates()` generator, the
// pluggable `priorFor` seam, top-K + first-play-urgency opening, and stable
// identity keys — plus the three traversal seams (`decidingPlayer`,
// `enumerateMoves`, `applyMoveInSearch`) for the yes/no family and the
// modal `option-pick` generator (issue #1428) and the `search-library`
// fetch/tutor generator (CR 701.19, issue #1429).

import { describe, it, expect, afterEach, vi } from "vitest";
import type { GameState, PendingChoice } from "../state";
import { resolveTopOfStack } from "../state";
import type { CardDefinition, EffectOp, MayPayCost } from "../../cards/types";
import { registerTokenDefinition } from "../../cards";

/** A fixed-cardinal sacrifice leg (CR 701.16b) over creatures. */
const SAC_ONE_CREATURE: MayPayCost = {
    sacrifice: { count: 1, filter: { types: ["Creature"] } },
};
import {
    decidingPlayer,
    applyMoveInSearch,
    searchWithTrace,
    selectRootMove,
    type Edge,
    type Node,
} from "../search";
import { enumerateMoves, type Move } from "../moves";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
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
import * as choicePriorsModule from "../ai/choicePriors";
import {
    makeState,
    makePlayer,
    makeInstance,
    pushSpell,
} from "../../cards/__tests__/setup";
import { crawWurm, grizzlyBears } from "../../cards/sets/lea/green";
import { forest } from "../../cards/sets/lea/colorless";
import { lightningBolt } from "../../cards/sets/lea/red";
import { blackLotus } from "../../cards/sets/lea/colorless";
import { mindStone } from "../../cards/sets/wth/colorless";
import { mirrisGuile } from "../../cards/sets/tmp/green";

afterEach(() => resetChoicePriorFn());

/** Registers a synthetic DSL-only sorcery under a stable test id (mirrors
 *  `interpreter.test.ts`'s `registerScript` helper). Test-only ids never enter
 *  `getAllCards()`, so the catalogue sweep stays clean. */
function registerSpellScript(id: string, effects: EffectOp[]): string {
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

/** p1 owns a library of `libraryDefIds` (instance ids `<prefix>-<i>`) and
 *  `landsInPlay` Forests on the battlefield, with a head `search-library`
 *  pending choice (CR 701.19). */
function stateWithLibrarySearch(
    libraryDefIds: string[],
    choice: Partial<PendingChoice> = {},
    opts: { landsInPlay?: number; idPrefix?: string } = {}
): GameState {
    const prefix = opts.idPrefix ?? "lib";
    const state = makeState({
        players: [
            makePlayer("p1", {
                library: libraryDefIds.map((defId, i) =>
                    makeInstance(defId, {
                        id: `${prefix}-${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "library",
                    })
                ),
                battlefield: Array.from(
                    { length: opts.landsInPlay ?? 0 },
                    (_, i) =>
                        makeInstance(forest.id, {
                            id: `${prefix}-land-${i}`,
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
            kind: "search-library",
            zone: "library",
            count: 1,
            prompt: "Search your library for a card.",
            ...choice,
        } as PendingChoice,
    ];
    return state;
}

describe("choice-node candidate contract (CR 608.2 / ADR 0016, issue #1425)", () => {
    it("registers tranche 1 (yes/no family, option-pick, search-library) + random-reveal (issue #1511)", () => {
        expect(hasChoiceCandidateGenerator("may-pay")).toBe(true);
        expect(hasChoiceCandidateGenerator("land-entry-tapped")).toBe(true);
        expect(hasChoiceCandidateGenerator("draw-replacement")).toBe(true);
        expect(hasChoiceCandidateGenerator("option-pick")).toBe(true);
        expect(hasChoiceCandidateGenerator("search-library")).toBe(true);
        // CR 705.2 / ADR 0023 (issue #1511) — a degenerate single-candidate
        // acknowledge, not a real decision; registering it is the fix for the
        // playout halting mid-resolution on every coin-flip/reveal line.
        expect(hasChoiceCandidateGenerator("random-reveal")).toBe(true);
        // A kind outside these tranches is NOT an in-tree node yet — additive
        // by design: no generator means the historical no-decision behavior.
        expect(hasChoiceCandidateGenerator("discard-hand")).toBe(false);
        expect(Object.keys(CHOICE_CANDIDATE_GENERATORS).length).toBe(6);
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

    it("random-reveal (CR 705.2 / ADR 0023, issue #1511): a degenerate single-candidate ack", () => {
        // Unlike every other family the chooser makes NO real decision — the
        // outcome was already drawn from the seeded PRNG and persisted on the
        // choice when it was raised. The generator's only job is to surface
        // the one legal "resume" answer so the kind becomes an in-tree node.
        const state = stateWithChoice({ kind: "random-reveal" });
        const cands = choiceCandidates(state, state.pendingChoices![0]);
        expect(cands.map((c) => c.key)).toEqual(["random-reveal:ack"]);
        expect(cands[0].move).toEqual({
            kind: "random-reveal-ack",
            stackItemId: "stack-1",
            choiceId: "c1",
        });
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
        const id = registerSpellScript("test-1428-option-pick-traversal", [
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

    it("applyMoveInSearch resolves a random-reveal-ack through the real resolver (issue #1511)", () => {
        // CR 705.2 / ADR 0023 — the coin-flip choice: applying the ack must
        // clear the queue, run the ALREADY-DETERMINIZED branch's effects, and
        // resume the game (past the node) — mirroring the land-entry /
        // option-pick traversal tests above. Before this seam existed,
        // `applyMoveInSearch` had no case for `random-reveal-ack`, so the
        // move applied as a no-op and the tree never advanced past the node.
        const id = registerSpellScript("test-1511-random-reveal-traversal", [
            {
                op: "coinFlip",
                win: {
                    consequence: "Gain 5 life",
                    effects: [
                        { op: "gainLife", player: "controller", amount: 5 },
                    ],
                },
                loss: {
                    consequence: "Lose 5 life",
                    effects: [
                        { op: "loseLife", player: "controller", amount: 5 },
                    ],
                },
            },
        ]);
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            priorityPlayerId: "p1",
            activePlayerId: "p1",
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the reveal
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("random-reveal");
        expect(decidingPlayer(state)).toBe("p1");
        expect(enumerateMoves(state, "p1")).toEqual([
            {
                kind: "random-reveal-ack",
                stackItemId: head.stackItemId,
                choiceId: head.choiceId,
            },
        ]);
        const won = head.result === 1;

        applyMoveInSearch(state, "p1", {
            kind: "random-reveal-ack",
            stackItemId: head.stackItemId,
            choiceId: head.choiceId,
        });

        expect(state.players[0].life).toBe(won ? 25 : 15); // the landed branch ran
        expect(state.pendingChoices?.length ?? 0).toBe(0);
        expect(state.stack).toHaveLength(0);
    });
});

describe("random-reveal playout: a coin-flip line descends past the node instead of halting (issue #1511)", () => {
    it("a manual rollout-style ply loop reaches the post-reveal stable state, not a mid-resolution leaf", () => {
        // Reproduces the exact shape `rollout`/`iterate` drive: repeatedly ask
        // `decidingPlayer` for who owes a decision, `enumerateMoves` for the
        // legal answers, and apply the chosen one. Before the fix,
        // `decidingPlayer` returned null the instant the coin-flip choice
        // went live (no registered generator), so this loop broke on ply 0
        // with the reveal still pending — the exact "halts and leaf-scores
        // mid-resolution" pathology the issue describes. After the fix the
        // loop descends past the node within a couple of plies and lands on
        // the stable, fully-resolved state.
        const id = registerSpellScript("test-1511-random-reveal-rollout", [
            {
                op: "coinFlip",
                win: {
                    consequence: "Gain 5 life",
                    effects: [
                        { op: "gainLife", player: "controller", amount: 5 },
                    ],
                },
                loss: {
                    consequence: "Lose 5 life",
                    effects: [
                        { op: "loseLife", player: "controller", amount: 5 },
                    ],
                },
            },
        ]);
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            priorityPlayerId: "p1",
            activePlayerId: "p1",
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the reveal
        expect(state.pendingChoices?.[0]?.kind).toBe("random-reveal");

        let plies = 0;
        for (; plies < 5; plies++) {
            const pid = decidingPlayer(state);
            if (!pid) break;
            const moves = enumerateMoves(state, pid);
            if (moves.length === 0) break;
            applyMoveInSearch(state, pid, moves[0]);
        }

        // Descended past the reveal — reached a stable leaf, not a stall on
        // ply 0 with the choice still pending.
        expect(plies).toBeGreaterThan(0);
        expect(state.pendingChoices?.length ?? 0).toBe(0);
        expect(state.stack).toHaveLength(0);
        expect([15, 25]).toContain(state.players[0].life);
    });
});

describe("option-pick playout: searchWithTrace picks a sensible mode (issue #1428)", () => {
    it("picks the LETHAL mode over the useless one on a targeted position", () => {
        // p2 is at 3 life: the "kill" mode (lose 5) wins the game outright, the
        // "gain" mode does nothing relevant. Search must find and prefer the
        // lethal mode once the choice node is live — mirroring `search.test.ts`'s
        // "burns the opponent's face for the kill" shape, but for a MODE pick
        // instead of a target pick.
        const id = registerSpellScript("test-1428-option-pick-playout", [
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
            players: [makePlayer("p1"), makePlayer("p2", { life: 3 })],
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

describe("search-library generator (CR 701.19 — fetchlands / tutors, issue #1429)", () => {
    it("collapses the pool to DISTINCT card identities, keyed by name", () => {
        // Four Forests are ONE decision ("fetch a Forest"), not four.
        const state = stateWithLibrarySearch([
            forest.id,
            forest.id,
            forest.id,
            forest.id,
            grizzlyBears.id,
        ]);
        const cands = choiceCandidates(state, state.pendingChoices![0]);
        expect(cands.map((c) => c.key).sort()).toEqual([
            "search-library:Forest",
            "search-library:Grizzly Bears",
        ]);
        // …and no key leaks a per-world instance id.
        expect(cands.every((c) => !c.key.includes("lib-"))).toBe(true);
    });

    it("ranks targets by worth: the bigger body opens before the smaller one", () => {
        const state = stateWithLibrarySearch(
            [grizzlyBears.id, crawWurm.id],
            {},
            { landsInPlay: 5 }
        );
        const cands = choiceCandidates(state, state.pendingChoices![0]);
        expect(cands[0].key).toBe("search-library:Craw Wurm");
        expect(cands.map((c) => c.key)).toContain(
            "search-library:Grizzly Bears"
        );
        expect(cands[0].hint?.materialGained).toBeGreaterThan(
            cands[1].hint?.materialGained ?? 0
        );
    });

    it("prices a fetched LAND against the searcher's mana development", () => {
        // Land-light (the fetchland's real window): the land outranks a body.
        const early = stateWithLibrarySearch(
            [crawWurm.id, forest.id],
            {},
            { landsInPlay: 0 }
        );
        expect(choiceCandidates(early, early.pendingChoices![0])[0].key).toBe(
            "search-library:Forest"
        );
        // Flooded: another land is nearly worthless, the body wins.
        const flooded = stateWithLibrarySearch(
            [crawWurm.id, forest.id],
            {},
            { landsInPlay: 5 }
        );
        expect(
            choiceCandidates(flooded, flooded.pendingChoices![0])[0].key
        ).toBe("search-library:Craw Wurm");
    });

    it("honors the precomputed candidateIds allow-list (a FILTERED tutor)", () => {
        // A fetchland's "search for a basic land card" is precomputed into
        // `candidateIds` when the choice is raised (hidden zone, CR 400.2).
        const state = stateWithLibrarySearch(
            [grizzlyBears.id, forest.id, crawWurm.id],
            { candidateIds: ["lib-1"] }
        );
        const cands = choiceCandidates(state, state.pendingChoices![0]);
        expect(cands.map((c) => c.key)).toEqual(["search-library:Forest"]);
        expect(cands[0].move).toMatchObject({
            kind: "resolution-choice",
            stackItemId: "stack-1",
            step: 0,
            choiceId: "c1",
            cardInstanceIds: ["lib-1"],
        });
    });

    it("CR 701.19c: 'fail to find' is a branch only when the count admits it", () => {
        const may = stateWithLibrarySearch([forest.id], {
            count: { min: 0, max: 1 },
        });
        expect(
            choiceCandidates(may, may.pendingChoices![0]).map((c) => c.key)
        ).toContain("search-library:none");

        const mustFind = stateWithLibrarySearch([forest.id], { count: 1 });
        expect(
            choiceCandidates(mustFind, mustFind.pendingChoices![0]).map(
                (c) => c.key
            )
        ).toEqual(["search-library:Forest"]);
    });

    it("finding outranks failing to find, but failing stays reachable", () => {
        const state = stateWithLibrarySearch([crawWurm.id], {
            count: { min: 0, max: 1 },
        });
        const cands = choiceCandidates(state, state.pendingChoices![0]);
        expect(cands[0].key).toBe("search-library:Craw Wurm");
        expect(cands[cands.length - 1].key).toBe("search-library:none");
        expect(cands[cands.length - 1].prior).toBeGreaterThan(0);
    });

    it("an EMPTY eligible pool with a mandatory count is no decision node", () => {
        const state = stateWithLibrarySearch([], { count: 1 });
        expect(choiceCandidates(state, state.pendingChoices![0])).toEqual([]);
        expect(decidingPlayer(state)).toBeNull();
    });

    it("branching is BOUNDED at top-K, never the whole matching library", () => {
        const bulk = Array.from({ length: 20 }, (_, i) => {
            const id = `test-1429-bulk-${i}`;
            registerTokenDefinition({
                id,
                name: `Bulk Creature ${i}`,
                rarity: "common",
                manaCost: { G: 1 },
                types: ["Creature"],
                power: i + 1,
                toughness: 1,
            } as CardDefinition);
            return id;
        });
        const state = stateWithLibrarySearch(bulk);
        // Assert against the GENERATOR, not `choiceCandidates`: the latter
        // `slice(0, k)`s ANY generator's output, so a length assertion on it
        // holds even when the generator enumerates the whole library. Only the
        // raw generator output can fail — this is the assertion that pins the
        // "bounded, never the full matching library" AC (issue #1429).
        const raw = CHOICE_CANDIDATE_GENERATORS["search-library"]!(
            state,
            state.pendingChoices![0]
        );
        expect(raw.length).toBeLessThanOrEqual(CHOICE_TOP_K);
        expect(raw.length).toBeLessThan(bulk.length);

        const cands = choiceCandidates(state, state.pendingChoices![0]);
        expect(cands.length).toBeLessThanOrEqual(CHOICE_TOP_K);
        // The pruning is POLICY-driven, not arbitrary: the best body survives.
        expect(cands[0].key).toBe("search-library:Bulk Creature 19");
    });

    it("a multi-card search fills greedily and keys the whole multiset", () => {
        // "Search for up to two cards": the answer space is the subset lattice;
        // the generator emits one candidate per LEAD identity, greedily filled.
        const state = stateWithLibrarySearch([grizzlyBears.id, crawWurm.id], {
            count: 2,
        });
        const cands = choiceCandidates(state, state.pendingChoices![0]);
        expect(cands.map((c) => c.key)).toEqual([
            "search-library:Craw Wurm | Grizzly Bears",
        ]);
        expect(cands[0].move).toMatchObject({
            cardInstanceIds: ["lib-1", "lib-0"],
        });
    });

    it("keys are STABLE across determinizations; the MOVE names this world's ids", () => {
        // ISMCTS reshuffles the searcher's library every iteration: same cards,
        // different order and (for a fabricated world) different ids.
        const worldA = stateWithLibrarySearch(
            [grizzlyBears.id, crawWurm.id],
            {},
            { idPrefix: "worldA" }
        );
        const worldB = stateWithLibrarySearch(
            [crawWurm.id, grizzlyBears.id],
            {},
            { idPrefix: "worldB" }
        );
        const keysA = choiceCandidates(worldA, worldA.pendingChoices![0]).map(
            (c) => c.key
        );
        const keysB = choiceCandidates(worldB, worldB.pendingChoices![0]).map(
            (c) => c.key
        );
        expect(keysA).toEqual(keysB);

        const wurmA = choiceCandidates(worldA, worldA.pendingChoices![0])[0];
        const wurmB = choiceCandidates(worldB, worldB.pendingChoices![0])[0];
        expect(wurmA.key).toBe("search-library:Craw Wurm");
        expect(wurmA.move).toMatchObject({ cardInstanceIds: ["worldA-1"] });
        expect(wurmB.move).toMatchObject({ cardInstanceIds: ["worldB-0"] });
    });

    it("enumerateMoves / decidingPlayer expose the node to the search", () => {
        const state = stateWithLibrarySearch([grizzlyBears.id, crawWurm.id]);
        expect(decidingPlayer(state)).toBe("p1");
        const moves = enumerateMoves(state, "p1");
        expect(moves).toHaveLength(2);
        expect(moves.every((m) => m.kind === "resolution-choice")).toBe(true);
    });

    it("applyMoveInSearch fetches through the real resolver (fetchland pattern)", () => {
        const id = registerSpellScript("test-1429-search-library-traversal", [
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                filter: { type: "Creature" },
                count: 1,
                prompt: "Search your library for a creature card.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "library",
                to: "battlefield",
            },
            { op: "libraryLook", action: "shuffle", player: "controller" },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [
                        makeInstance(grizzlyBears.id, {
                            id: "lib-bear",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                        makeInstance(crawWurm.id, {
                            id: "lib-wurm",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
            priorityPlayerId: "p1",
            activePlayerId: "p1",
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the search
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("search-library");
        expect(decidingPlayer(state)).toBe("p1");

        const cands = choiceCandidates(state, head);
        const wurm = cands.find((c) => c.key === "search-library:Craw Wurm")!;
        applyMoveInSearch(state, "p1", wurm.move);

        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "lib-wurm"
        );
        expect(state.players[0].library.map((c) => c.id)).not.toContain(
            "lib-wurm"
        );
        expect(state.pendingChoices?.length ?? 0).toBe(0);
        expect(state.stack).toHaveLength(0);
    });
});

describe("search-library playout: searchWithTrace fetches a sensible target (issue #1429)", () => {
    it("puts the 6/4 onto the battlefield instead of the 2/2", () => {
        const id = registerSpellScript("test-1429-search-library-playout", [
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                filter: { type: "Creature" },
                count: 1,
                prompt: "Search your library for a creature card.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "library",
                to: "battlefield",
            },
            { op: "libraryLook", action: "shuffle", player: "controller" },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [
                        makeInstance(grizzlyBears.id, {
                            id: "lib-bear",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                        makeInstance(crawWurm.id, {
                            id: "lib-wurm",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
            priorityPlayerId: "p1",
            activePlayerId: "p1",
        });
        pushSpell(state, id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the search
        expect(decidingPlayer(state)).toBe("p1");

        const { move } = searchWithTrace(state, "p1", { iterations: 200 }, 7);
        expect(move?.kind).toBe("resolution-choice");
        if (move?.kind !== "resolution-choice") throw new Error("kind");
        expect(move.cardInstanceIds).toEqual(["lib-wurm"]);
    });
});

// Two determinization-safety guards on the `search-library` node. Both concern
// the SAME structural fact: an edge is keyed by stable identity, but the cards
// behind that identity live in a HIDDEN zone that `determinize` re-deals every
// iteration — so neither the pool size nor the instance ids captured when the
// edge was opened may be trusted in another world (PRD #1423, issue #1429).
describe("search-library determinization safety (issue #1429)", () => {
    it("emits NO pick when this world's pool is smaller than the choice minimum", () => {
        // "Search target opponent's library for two cards": `determinize`
        // re-deals the opponent's hand↔library, so a world can show fewer than
        // `min` eligible cards. A short submission is ILLEGAL, and the throw
        // would escape `iterate` and kill the whole search — so the generator
        // must offer nothing rather than an under-count pick.
        const state = stateWithLibrarySearch([grizzlyBears.id], {
            count: { min: 2, max: 2 },
        });
        const head = state.pendingChoices![0];
        expect(
            CHOICE_CANDIDATE_GENERATORS["search-library"]!(state, head)
        ).toEqual([]);
        expect(choiceCandidates(state, head)).toEqual([]);
    });

    it("pins WHY: the real resolver rejects an under-count submission", () => {
        const state = stateWithLibrarySearch([grizzlyBears.id], {
            count: { min: 2, max: 2 },
        });
        expect(() =>
            applyPendingChoiceSubmit(state, {
                stackItemId: "stack-1",
                step: 0,
                choiceId: "c1",
                playerId: "p1",
                cardInstanceIds: ["lib-0"],
            })
        ).toThrow(/Select at least 2 cards/);
    });

    it("selectRootMove re-resolves the winning edge against the ROOT world", () => {
        // The root world (the REAL state the move is submitted against).
        const rootState = stateWithLibrarySearch(
            [grizzlyBears.id, crawWurm.id],
            {},
            { idPrefix: "root" }
        );
        // The edge as it was OPENED, in a different determinization: same stable
        // key, instance ids that do not exist in the root world at all (for an
        // opponent-zone search those cards sit in the opponent's HAND there).
        const staleMove: Move = {
            kind: "resolution-choice",
            stackItemId: "stack-1",
            step: 0,
            choiceId: "c1",
            cardInstanceIds: ["ghost-7"],
        };
        const edge: Edge = {
            move: staleMove,
            key: "search-library:Craw Wurm",
            mover: "p1",
            node: { children: new Map() },
            visits: 100,
            totalReward: 60,
            totalMargin: 0,
            avail: 100,
        };
        const root: Node = { children: new Map([[edge.key, edge]]) };

        const chosen = selectRootMove(
            root,
            enumerateMoves(rootState, "p1"),
            rootState,
            "p1"
        );
        // The ROOT world's Craw Wurm, not the stale id.
        expect(chosen).toMatchObject({ cardInstanceIds: ["root-1"] });
        // …and every id it names really is in the root world's searched zone,
        // which is what makes the submission legal.
        if (chosen.kind !== "resolution-choice") throw new Error("kind");
        const libraryIds = rootState.players[0].library.map((c) => c.id);
        for (const id of chosen.cardInstanceIds ?? []) {
            expect(libraryIds).toContain(id);
        }
    });
});

describe("dslChoicePrior: OP_VALUERS context-aware (issue #1433)", () => {
    /** Registers a synthetic noncreature Artifact under a stable test id,
     *  optionally carrying a real Effect Script — mirrors `registerSpellScript`
     *  but for a PERMANENT (a search-library / discard target) rather than a
     *  cast sorcery. */
    function registerArtifact(
        id: string,
        name: string,
        effects?: EffectOp[]
    ): string {
        registerTokenDefinition({
            id,
            name,
            rarity: "common",
            manaCost: { C: 1 },
            types: ["Artifact"],
            ...(effects ? { effects } : {}),
        } as CardDefinition);
        return id;
    }

    /** Registers a synthetic noncreature Artifact whose ONLY script lives on
     *  an ACTIVATED ABILITY — no top-level `effects[]` of its own (the
     *  Nevinyrral's Disk / Icy Manipulator / Royal Assassin shape, issue
     *  #1433 review finding 1). */
    function registerAbilityOnlyArtifact(
        id: string,
        name: string,
        abilityEffects: EffectOp[]
    ): string {
        registerTokenDefinition({
            id,
            name,
            rarity: "common",
            manaCost: { C: 3 },
            types: ["Artifact"],
            activatedAbilities: [
                {
                    id: `${id}-ability`,
                    cost: { tap: true, sacrifice: true },
                    useStack: true,
                    effects: abilityEffects,
                },
            ],
        } as CardDefinition);
        return id;
    }

    it("search-library: candidateValue's OP_VALUERS worth (not the flat v1 constant) ranks a noncreature's own script — the SHARED refactor, exercised through priorFor", () => {
        // NOTE (issue #1433 review finding 4): this pins the `candidateValue.ts`
        // refactor (`noncreatureCardWorth` reading a real script instead of the
        // v1 flat 30) — it does NOT discriminate `dslChoicePrior` from
        // `heuristicChoicePrior` specifically. Both providers read this exact
        // worth: `dslSearchLibraryPrior` via `libraryTargetWorth`, and
        // `heuristicChoicePrior` via the candidate generator's `hint.materialGained`
        // (`searchLibraryCandidates`, `choiceCandidates.ts`), which is computed
        // through the SAME `libraryTargetWorth`. Swapping the default provider
        // back to `heuristicChoicePrior` leaves this test green — see the
        // "priorFor's default provider genuinely differs..." test below for the
        // assertion that actually pins the provider swap itself.
        //
        // Alphabetically "AAA" precedes "ZZZ" — under the old flat-30 prior
        // both candidates tie, and the stable top-K sort's tie-break
        // (ascending identity) would put "AAA Do Nothing" first. The real fix
        // must win on ACTUAL worth despite that adverse tie-break.
        const doNothingId = registerArtifact(
            "test-1433-aaa-do-nothing",
            "AAA Do Nothing"
        );
        const shockRodId = registerArtifact(
            "test-1433-zzz-shock-rod",
            "ZZZ Shock Rod",
            [{ op: "dealDamage", amount: 5, to: { player: "opponent" } }]
        );
        const state = stateWithLibrarySearch([doNothingId, shockRodId]);
        const cands = choiceCandidates(state, state.pendingChoices![0]);
        const shockCand = cands.find((c) => c.key.includes("Shock Rod"))!;
        const nothingCand = cands.find((c) => c.key.includes("Do Nothing"))!;
        expect(shockCand).toBeDefined();
        expect(nothingCand).toBeDefined();

        // The real burn script outranks the do-nothing artifact...
        expect(cands[0].key).toBe("search-library:ZZZ Shock Rod");
        expect(shockCand.hint?.materialGained).toBeGreaterThan(
            nothingCand.hint?.materialGained ?? 0
        );
        // ...and the PRIOR itself carries the distinction — `priorFor` reads
        // the real library, not a per-kind flat guess.
        expect(shockCand.prior).toBeGreaterThan(nothingCand.prior);
    });

    it("search-library: an ABILITY-only noncreature (no spell effects[] of its own) ranks above a cheap creature/land, not the flat v1 floor (issue #1433 review finding 1)", () => {
        // Nevinyrral's Disk / Icy Manipulator / Royal Assassin shape: the
        // card's worth lives ENTIRELY on an activated ability's script — the
        // card itself has no `effects[]`. Before this fix,
        // `noncreatureCardWorth` only read the SPELL site
        // (`dslSpellScriptOpValue`), so this card fell through to the v1 flat
        // floor (30) and a tutor would rank a vanilla 1/1 or a basic land
        // ABOVE it despite the ability being real removal.
        const diskId = registerAbilityOnlyArtifact(
            "test-1433-finding1-disk",
            "Finding1 Disk",
            [{ op: "dealDamage", amount: 20, to: { player: "opponent" } }]
        );
        const cheapCreatureId = "test-1433-finding1-cheap-creature";
        registerTokenDefinition({
            id: cheapCreatureId,
            name: "Finding1 Cheap Creature",
            rarity: "common",
            manaCost: { G: 1 },
            types: ["Creature"],
            power: 1,
            toughness: 1,
        } as CardDefinition);

        const state = stateWithLibrarySearch(
            [diskId, cheapCreatureId, forest.id],
            {},
            { landsInPlay: 5 } // flooded — a fetched land is near-worthless too
        );
        const cands = choiceCandidates(state, state.pendingChoices![0]);
        const diskCand = cands.find((c) => c.key.includes("Finding1 Disk"))!;
        const creatureCand = cands.find((c) =>
            c.key.includes("Finding1 Cheap Creature")
        )!;
        expect(diskCand).toBeDefined();
        expect(creatureCand).toBeDefined();

        // The ability-only card's real (undiscounted-at-30, script-derived)
        // worth outranks BOTH the cheap creature and the (flooded) land.
        expect(cands[0].key).toBe("search-library:Finding1 Disk");
        expect(diskCand.hint?.materialGained).toBeGreaterThan(
            creatureCand.hint?.materialGained ?? 0
        );
        expect(diskCand.prior).toBeGreaterThan(creatureCand.prior);
    });

    it("search-library: three REAL sub-90-point scripts (burn / draw-1 / scry-only) stay strictly ordered by script value — the flat floor no longer collapses them (issue #1513)", () => {
        // Before the fix, `noncreatureCardWorth` clamped EVERY scripted
        // noncreature UP to `NONCREATURE_FLOOR` (30) whenever its rescaled
        // value fell below it — i.e. whenever its raw OP_VALUERS points fell
        // below 90. All three cards below score under that line (Lightning
        // Bolt's own 3-damage script is 66 raw points, Mind Stone's
        // ability-discounted draw is 22.5, Mirri's Guile's ability-discounted
        // scry is 15), so under the old flat floor they were ALL priced at
        // 30 — indistinguishable from a do-nothing card, and from each
        // other. Real, low-cost, already-shipped cards (not synthetic test
        // fixtures) so the assertion pins the actual catalogue, not a
        // hand-tuned stand-in.
        const state = stateWithLibrarySearch([
            lightningBolt.id, // burn: dealDamage 3 (own spell script)
            mindStone.id, // draw-1: sacrifice ability draws a card
            mirrisGuile.id, // scry-only: upkeep ability, may-look-and-reorder
        ]);
        const cands = choiceCandidates(state, state.pendingChoices![0]);
        const boltCand = cands.find((c) => c.key.includes("Lightning Bolt"))!;
        const stoneCand = cands.find((c) => c.key.includes("Mind Stone"))!;
        const guileCand = cands.find((c) => c.key.includes("Mirri's Guile"))!;
        expect(boltCand).toBeDefined();
        expect(stoneCand).toBeDefined();
        expect(guileCand).toBeDefined();

        // Strict ordering by script value: burn > draw-1 cantrip > scry-only.
        expect(boltCand.hint?.materialGained ?? 0).toBeGreaterThan(
            stoneCand.hint?.materialGained ?? 0
        );
        expect(stoneCand.hint?.materialGained ?? 0).toBeGreaterThan(
            guileCand.hint?.materialGained ?? 0
        );
        // And every one of them is strictly ABOVE zero — a real script,
        // however small, is never a "do-nothing" card.
        expect(guileCand.hint?.materialGained ?? 0).toBeGreaterThan(0);

        // The prior itself carries the same distinction, and Lightning Bolt
        // — the strongest real script — leads the ranked candidate set.
        expect(cands[0].key).toBe("search-library:Lightning Bolt");
        expect(boltCand.prior).toBeGreaterThan(stoneCand.prior);
        expect(stoneCand.prior).toBeGreaterThan(guileCand.prior);
    });

    it("search-library: a card with NO script anywhere (Black Lotus's `effect:`-shorthand mana ability) keeps a non-zero fallback worth (issue #1513)", () => {
        // The floor still exists — it just applies ONLY to the honest
        // "no Op maps" fallback, never to a real script. Black Lotus's mana
        // ability is an imperative `effect:` closure (no `effects[]`/
        // `aiEffects` DSL script), the documented no-script case
        // `noncreatureCardWorth` falls back to — it must still price at the
        // flat floor, not zero — losing the fallback entirely would be its
        // own bug.
        const state = stateWithLibrarySearch([blackLotus.id]);
        const cands = choiceCandidates(state, state.pendingChoices![0]);
        const lotusCand = cands.find((c) => c.key.includes("Black Lotus"))!;
        expect(lotusCand).toBeDefined();
        expect(lotusCand.hint?.materialGained).toBe(30);
    });

    it("search-library: a targeted removal script's prior scales with the REAL biggest threat on the opponent's board", () => {
        const terrorId = registerArtifact(
            "test-1433-terror-artifact",
            "Terror Artifact",
            [{ op: "destroy", target: { target: 0 } }]
        );

        function stateWithOpponentThreat(hasThreat: boolean): GameState {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        library: [
                            makeInstance(terrorId, {
                                id: "threat-lib-0",
                                controllerId: "p1",
                                ownerId: "p1",
                                zone: "library",
                            }),
                        ],
                    }),
                    makePlayer("p2", {
                        battlefield: hasThreat
                            ? [
                                  makeInstance(crawWurm.id, {
                                      id: "opp-wurm",
                                      controllerId: "p2",
                                      ownerId: "p2",
                                      zone: "battlefield",
                                  }),
                              ]
                            : [],
                    }),
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
                    kind: "search-library",
                    zone: "library",
                    count: 1,
                    prompt: "Search your library for a card.",
                },
            ];
            return state;
        }

        const emptyBoard = stateWithOpponentThreat(false);
        const threatenedBoard = stateWithOpponentThreat(true);
        const priorEmpty = choiceCandidates(
            emptyBoard,
            emptyBoard.pendingChoices![0]
        )[0].prior;
        const priorThreatened = choiceCandidates(
            threatenedBoard,
            threatenedBoard.pendingChoices![0]
        )[0].prior;

        // The SAME removal spell is a more urgent find when a real target
        // (the Craw Wurm) sits on the opponent's board right now — the
        // context-aware read `cardValue`'s context-free scoring can't make.
        expect(priorThreatened).toBeGreaterThan(priorEmpty);
    });

    it("priorFor's default provider genuinely differs from heuristicChoicePrior (issue #1433 review finding 4)", () => {
        // Reuses the biggest-threat shape, but pins the PROVIDER SWAP itself:
        // `heuristicChoicePrior` only ever reads the candidate generator's
        // CONTEXT-FREE `hint.materialGained` — it has no opinion on the real
        // opposing board — while `dslChoicePrior`'s search-library leg adds
        // `contextAwareRemovalBonus` on top. Calling BOTH providers on the
        // IDENTICAL candidate/state proves they diverge; the earlier tests in
        // this describe block only pin the shared `candidateValue` refactor,
        // which lifts both providers equally and is silent on the swap.
        const terrorId = registerArtifact(
            "test-1433-finding4-terror",
            "Finding4 Terror",
            [{ op: "destroy", target: { target: 0 } }]
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [
                        makeInstance(terrorId, {
                            id: "f4-lib-0",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(crawWurm.id, {
                            id: "f4-opp-wurm",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "battlefield",
                        }),
                    ],
                }),
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
                kind: "search-library",
                zone: "library",
                count: 1,
                prompt: "Search your library for a card.",
            },
        ];
        const head = state.pendingChoices[0];
        const raw = CHOICE_CANDIDATE_GENERATORS["search-library"]!(state, head);
        const candidate = raw.find((c) => c.key.includes("Terror"))!;
        expect(candidate).toBeDefined();

        // The exact SAME (state, choice, candidate) triple, scored by each
        // provider directly — no ordering indirection.
        expect(priorFor(state, head, candidate)).toBeGreaterThan(
            heuristicChoicePrior(state, head, candidate)
        );
    });

    it("search-library: contextAwareGroundingForChoice prices a count-scaled script off the REAL board, not the context-free representative floor (issue #1433 review finding 2)", () => {
        // A script whose amount is `{ count: { zone: "battlefield", ... } }`
        // (CR 122 counting — "damage equal to the number of creatures you
        // control") is the shape `contextAwareGrounding` exists FOR: at a
        // choice node the card hasn't been cast yet, so `contextFreeGrounding`
        // can only assume a representative count of 1, identically regardless
        // of the real board. `contextAwareGroundingForChoice`
        // (`candidateValue.ts`) is the first production caller of
        // `contextAwareGrounding` — this asserts it actually runs.
        const countBurnId = registerArtifact(
            "test-1433-count-burn",
            "Count Burn",
            [
                {
                    op: "dealDamage",
                    amount: {
                        count: {
                            zone: "battlefield",
                            controller: "controller",
                            filter: { type: "Creature" },
                        },
                    },
                    to: { player: "opponent" },
                },
            ]
        );

        function stateWithSearcherCreatures(n: number): GameState {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        library: [
                            makeInstance(countBurnId, {
                                id: "cb-lib-0",
                                controllerId: "p1",
                                ownerId: "p1",
                                zone: "library",
                            }),
                        ],
                        battlefield: Array.from({ length: n }, (_, i) =>
                            makeInstance(grizzlyBears.id, {
                                id: `cb-bear-${i}`,
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
                    kind: "search-library",
                    zone: "library",
                    count: 1,
                    prompt: "Search your library for a card.",
                },
            ];
            return state;
        }

        // Comfortably above (5 creatures) / at (0 creatures) the noncreature
        // floor's rescale threshold, so the two don't tie at the floor.
        const empty = stateWithSearcherCreatures(0);
        const crowded = stateWithSearcherCreatures(5);

        const emptyPrior = choiceCandidates(empty, empty.pendingChoices![0])[0]
            .prior;
        const crowdedPrior = choiceCandidates(
            crowded,
            crowded.pendingChoices![0]
        )[0].prior;
        expect(crowdedPrior).toBeGreaterThan(emptyPrior);

        // And this IS `dslChoicePrior`-specific, not the shared hint refactor:
        // the candidate generator's hint stays CONTEXT-FREE (a representative
        // count of 1) regardless of board, so `heuristicChoicePrior` sees the
        // IDENTICAL hint on both boards and can never tell them apart.
        const rawEmpty = CHOICE_CANDIDATE_GENERATORS["search-library"]!(
            empty,
            empty.pendingChoices![0]
        );
        const rawCrowded = CHOICE_CANDIDATE_GENERATORS["search-library"]!(
            crowded,
            crowded.pendingChoices![0]
        );
        const candEmpty = rawEmpty.find((c) => c.key.includes("Count Burn"))!;
        const candCrowded = rawCrowded.find((c) =>
            c.key.includes("Count Burn")
        )!;
        expect(
            heuristicChoicePrior(empty, empty.pendingChoices![0], candEmpty)
        ).toBe(
            heuristicChoicePrior(
                crowded,
                crowded.pendingChoices![0],
                candCrowded
            )
        );
    });

    it("may-pay: candidateValue's OP_VALUERS worth (not the flat v1 constant) ranks a discard candidate's own script — the SHARED refactor, not a dslChoicePrior-specific leg", () => {
        // NOTE (issue #1433 review findings 3 & 4): `may-pay` has NO separate
        // DSL prior leg — `dslChoicePrior` falls straight through to
        // `heuristicChoicePrior` for this kind (finding 3: a standalone
        // `dslMayPayPrior` was deleted as a strictly-less-robust duplicate of
        // the heuristic's own `hint.materialGivenUp`-driven band). This test
        // pins the SHARED `candidateValue.ts` refactor instead —
        // `prospectiveCardWorth`/`noncreatureCardWorth` reading a real script —
        // which the may-pay candidate generator (`mayPayCandidates`,
        // `choiceCandidates.ts`) already fed into BOTH the pre-#1433 and
        // post-#1433 world via `hint.materialGivenUp`. Reverting the provider
        // swap entirely leaves this test green.
        const doNothingId = registerArtifact(
            "test-1433-mp-do-nothing",
            "MP Do Nothing"
        );
        const midBurnId = registerArtifact(
            "test-1433-mp-mid-burn",
            "MP Mid Burn",
            [{ op: "dealDamage", amount: 8, to: { player: "opponent" } }]
        );
        const bigBurnId = registerArtifact(
            "test-1433-mp-big-burn",
            "MP Big Burn",
            [{ op: "dealDamage", amount: 20, to: { player: "opponent" } }]
        );
        const cost: MayPayCost = { discard: { count: 1 } };

        function stateWithHand(cardIds: string[]): GameState {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        hand: cardIds.map((id, i) =>
                            makeInstance(id, {
                                id: `hand-${i}`,
                                controllerId: "p1",
                                ownerId: "p1",
                                zone: "hand",
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
                    kind: "may-pay",
                    cost,
                    count: 1,
                    prompt: "Discard a card?",
                },
            ];
            return state;
        }

        // "Cheap" hand: worst-first discards the SCRIPTLESS artifact (worth
        // the v1 flat floor) — the big burn spell is kept.
        const cheap = stateWithHand([doNothingId, bigBurnId]);
        // "Expensive" hand: no scriptless card to hide behind — worst-first
        // is FORCED to discard a real (if smaller) burn script.
        const expensive = stateWithHand([midBurnId, bigBurnId]);

        const acceptOf = (state: GameState) =>
            choiceCandidates(state, state.pendingChoices![0]).find((c) =>
                c.key.startsWith("may-pay:yes")
            )!;
        const cheapAccept = acceptOf(cheap);
        const expensiveAccept = acceptOf(expensive);

        expect(cheapAccept.move).toMatchObject({
            discardIds: ["hand-0"], // the scriptless "MP Do Nothing"
        });
        expect(expensiveAccept.move).toMatchObject({
            discardIds: ["hand-0"], // the smaller "MP Mid Burn" script
        });
        expect(expensiveAccept.hint?.materialGivenUp).toBeGreaterThan(
            cheapAccept.hint?.materialGivenUp ?? 0
        );
        // Giving up REAL material (even second-worst) costs more than giving
        // up a do-nothing card — the prior, not just the hint, says so.
        expect(cheapAccept.prior).toBeGreaterThan(expensiveAccept.prior);
    });
});

describe("decidingPlayer / enumerateMoves mirror (issue #1520)", () => {
    it("decidingPlayer is non-null exactly when enumerateMoves is non-empty for a pendingCompanionPay", () => {
        // CR 116.2 / 702.139f — a live companion payment is a continuation
        // the executor drives atomically, not a fresh macro-move (mirrors
        // pendingCast/pendingTarget/pendingActivation). Before the fix,
        // `decidingPlayer` didn't gate on `pendingCompanionPay`, so it named
        // `priorityPlayerId` as the decider while `enumerateMoves` — which DID
        // gate on it — returned []: a decider with an empty move list,
        // contradicting the documented invariant and stalling the playout.
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            priorityPlayerId: "p1",
            activePlayerId: "p1",
        });
        state.pendingCompanionPay = {
            playerId: "p1",
            manaCost: { X: 3 },
            tappedLandIds: [],
        };

        const pid = decidingPlayer(state);
        const moves = pid ? enumerateMoves(state, pid) : [];
        expect(pid === null || moves.length > 0).toBe(true);
        // Pinned to the actual desired shape, not just the invariant: a
        // pending companion payment is a non-decision window.
        expect(pid).toBeNull();
    });

    it("decidingPlayer stays non-null with a non-empty move list once pendingCompanionPay clears", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            priorityPlayerId: "p1",
            activePlayerId: "p1",
        });
        const pid = decidingPlayer(state);
        expect(pid).toBe("p1");
        expect(enumerateMoves(state, pid!).length).toBeGreaterThan(0);
    });

    it("mirror holds at a headChoice node too: pendingCompanionPay alongside a live choice yields no decider", () => {
        const state = stateWithChoice({ kind: "may-pay" });
        state.pendingCompanionPay = {
            playerId: "p1",
            manaCost: { X: 3 },
            tappedLandIds: [],
        };
        const pid = decidingPlayer(state);
        const moves = pid ? enumerateMoves(state, pid) : [];
        expect(pid === null || moves.length > 0).toBe(true);
        expect(pid).toBeNull();
    });
});

describe("choice-node candidate generation computed once per node visit (issue #1520)", () => {
    afterEach(() => vi.restoreAllMocks());

    it("decidingPlayer followed by enumerateMoves runs the generator+priorFor pass exactly once, not twice", () => {
        const spy = vi.spyOn(choicePriorsModule, "priorFor");
        const state = stateWithChoice({ kind: "may-pay" });

        const pid = decidingPlayer(state);
        expect(pid).toBe("p1");
        const moves = enumerateMoves(state, pid!);
        expect(moves.length).toBeGreaterThan(0);

        // may-pay with no cost yields exactly the yes/no pair — one full
        // generate+score pass costs 2 `priorFor` calls. Before the fix,
        // `decidingPlayer`'s non-emptiness check and `enumerateMoves`' actual
        // list each ran the generator independently: 4 calls for the same
        // node visit.
        expect(spy).toHaveBeenCalledTimes(moves.length);
    });

    it("repeated choiceCandidates calls for the SAME (state, choice) reuse the memoized result", () => {
        const spy = vi.spyOn(choicePriorsModule, "priorFor");
        const state = stateWithChoice({ kind: "may-pay" });
        const choice = state.pendingChoices![0];

        const first = choiceCandidates(state, choice);
        const second = choiceCandidates(state, choice);

        expect(second).toBe(first); // same array reference — cache hit
        expect(spy).toHaveBeenCalledTimes(first.length);
    });
});
