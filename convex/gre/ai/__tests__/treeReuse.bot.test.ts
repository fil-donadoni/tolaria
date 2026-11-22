// Tree reuse across the Bot's consults (issue #10470, ADR 0185): the walk of
// the kept tree, every reason it is dropped, the kept node made a root, and
// the budget counted in root visits.

import { describe, expect, it } from "vitest";
import type { PublicGameState } from "../../../gameProjections";
import { projectPublicState } from "../../../gameProjections";
import {
    adoptKeptRoot,
    applyMoveInSearch,
    moveKey,
    rootIsStarved,
    rootVisits,
    searchWithTrace,
    treeKeyOf,
    type Edge,
    type Node,
} from "../../search";
import type { GameState } from "../../state";
import { enumerateMoves } from "../../moves";
import { handleBrainRequest, type TreeKeeper } from "../brainRequest";
import { buildPositionFromSpec } from "../blade/build";
import { seatPlayerId } from "../blade/matcher";
import { BLADE_SEQUENCES } from "../blade/sequences";
import {
    continueKeptTree,
    crossesObservation,
    walkKeptTree,
    type KeptTree,
} from "../treeReuse";

const BOT = "bot";
const HUMAN = "human";

function node(): Node {
    return { children: new Map() };
}

function edge(key: string, mover: string, child: Node, visits = 1): Edge {
    return {
        move: { kind: "pass" },
        key,
        mover,
        node: child,
        visits,
        totalReward: visits / 2,
        totalMargin: 0,
        avail: visits,
    };
}

/** root --bot:a--> mid (opponent, views) --human:b--> leaf (bot: c, d). */
function smallTree(): { root: Node; mid: Node; leaf: Node } {
    const leaf = node();
    leaf.children.set("c", edge("c", BOT, node(), 3));
    leaf.children.set("d", edge("d", BOT, node(), 2));
    const mid = node();
    const view = node();
    view.children.set("b", edge("b", HUMAN, leaf, 5));
    mid.optionViews = new Map([["b", view]]);
    mid.childNodes = new Map([["b", leaf]]);
    const root = node();
    root.children.set("a", edge("a", BOT, mid, 6));
    return { root, mid, leaf };
}

describe("walkKeptTree", () => {
    it("follows the Bot's edges and the opponent's shared children", () => {
        const { root, leaf } = smallTree();
        const steps = [
            { seat: BOT, key: "a" },
            { seat: HUMAN, key: "b" },
        ];
        expect(walkKeptTree(root, steps, BOT)).toBe(leaf);
    });

    it("refuses a step the tree never took", () => {
        const { root } = smallTree();
        expect(walkKeptTree(root, [{ seat: BOT, key: "z" }], BOT)).toBeNull();
    });

    it("refuses a step made by the seat that did not decide the node", () => {
        const { root } = smallTree();
        // `a` is a Bot edge: the opponent cannot have played it.
        expect(walkKeptTree(root, [{ seat: HUMAN, key: "a" }], BOT)).toBeNull();
        // `mid` is the opponent's: a Bot step there is not this tree's path.
        expect(
            walkKeptTree(
                root,
                [
                    { seat: BOT, key: "a" },
                    { seat: BOT, key: "b" },
                ],
                BOT
            )
        ).toBeNull();
    });
});

/** A projection-shaped state: just what `visibleIdentities` reads. */
function view(
    botHand: string[],
    stack: Record<string, unknown>[] = [],
    battlefield: Record<string, unknown>[] = [],
    nextInstanceId = 50
): PublicGameState {
    return {
        nextInstanceId,
        players: [
            {
                id: BOT,
                hand: botHand.map((id) => ({ id, card: { id: `def-${id}` } })),
                battlefield,
                graveyard: [],
                exile: [],
                library: { count: 10, known: [] },
            },
            {
                id: HUMAN,
                hand: [null, null],
                battlefield: [],
                graveyard: [],
                exile: [],
                library: { count: 10, known: [] },
            },
        ],
        stack,
    } as unknown as PublicGameState;
}

describe("crossesObservation", () => {
    it("the Bot's own draw is an observation", () => {
        expect(
            crossesObservation(view(["1"]), view(["1", "7"]), new Set())
        ).toBe(true);
    });

    it("a card the opponent cast from its hand is not", () => {
        const cast = [{ id: "12", card: { id: "def-bolt" } }];
        expect(
            crossesObservation(view(["1"]), view(["1"], cast), new Set(["12"]))
        ).toBe(false);
        // Not shown by its own move: the Bot saw a hidden card.
        expect(
            crossesObservation(view(["1"]), view(["1"], cast), new Set())
        ).toBe(true);
    });

    it("a fresh object and an ability on the stack are not", () => {
        const token = [{ id: "51", card: { id: "token-soldier" } }];
        expect(
            crossesObservation(view(["1"]), view(["1"], [], token), new Set())
        ).toBe(false);
        const trigger = [
            { id: "t-1", card: { id: "def-x" }, triggeredAbilityId: "etb" },
        ];
        expect(
            crossesObservation(view(["1"]), view(["1"], trigger), new Set())
        ).toBe(false);
    });

    it("a known card turning to a new identity is an observation", () => {
        const down = [{ id: "3", card: { id: "face-down" } }];
        const up = [{ id: "3", card: { id: "def-morph" } }];
        expect(
            crossesObservation(view([], [], down), view([], [], up), new Set())
        ).toBe(true);
    });

    it("a card leaving the Bot's sight, or nothing at all, is not", () => {
        expect(
            crossesObservation(view(["1", "2"]), view(["1"]), new Set())
        ).toBe(false);
    });
});

describe("continueKeptTree", () => {
    const kept = (): KeptTree => ({
        gameId: "g",
        botId: BOT,
        catalogue: "c1",
        root: smallTree().root,
        projection: view(["1"]),
    });
    const ctx = { gameId: "g", botId: BOT, catalogue: "c1" };
    const path = [
        { seat: BOT, key: "a" },
        { seat: HUMAN, key: "b" },
    ];

    it("continues from the node the path reaches", () => {
        const result = continueKeptTree(kept(), ctx, path, view(["1"]));
        expect("node" in result && rootVisits(result.node)).toBe(5);
    });

    it("drops on a change of game, seat or catalogue", () => {
        for (const change of [
            { gameId: "other" },
            { botId: HUMAN },
            { catalogue: "c2" },
        ]) {
            expect(
                continueKeptTree(
                    kept(),
                    { ...ctx, ...change },
                    path,
                    view(["1"])
                )
            ).toEqual({ dropped: "context" });
        }
    });

    it("drops when the consult cannot say what was played", () => {
        expect(continueKeptTree(kept(), ctx, null, view(["1"]))).toEqual({
            dropped: "no-path",
        });
        expect(continueKeptTree(kept(), ctx, [], view(["1"]))).toEqual({
            dropped: "no-path",
        });
    });

    it("drops on a step the tree never took", () => {
        expect(
            continueKeptTree(
                kept(),
                ctx,
                [{ seat: BOT, key: "z" }],
                view(["1"])
            )
        ).toEqual({ dropped: "mismatch" });
    });

    it("drops when the path crossed an observation", () => {
        expect(continueKeptTree(kept(), ctx, path, view(["1", "9"]))).toEqual({
            dropped: "observation",
        });
    });
});

/** Case A of the note: a land drop, then the creature it pays for. */
const CASE_A = BLADE_SEQUENCES[0];

function caseA(): { state: GameState; botId: string } {
    const state = buildPositionFromSpec(CASE_A.spec);
    return { state, botId: seatPlayerId(state, "me") };
}

describe("adoptKeptRoot", () => {
    it("removes a denied edge with its statistics and clears below-root caches", () => {
        const { state, botId } = caseA();
        const passKey = treeKeyOf(state, botId, botId, { kind: "pass" })!;
        const landMove = enumerateMoves(state, botId).find(
            (m) => m.kind === "play-land"
        )!;
        const landKey = treeKeyOf(state, botId, botId, landMove)!;
        const kept = node();
        kept.children.set(passKey, edge(passKey, botId, node(), 4));
        kept.children.set(landKey, edge(landKey, botId, node(), 6));
        kept.dominatedTargetKeys = new Set(["x"]);
        kept.opposingGateArmKeys = new Set(["y"]);
        kept.dominatedBlockKeys = new Set(["z"]);

        const root = adoptKeptRoot(kept, state, botId, new Set([passKey]));
        expect(root).toBe(kept);
        expect([...root!.children.keys()]).toEqual([landKey]);
        expect(rootVisits(root!)).toBe(6);
        expect(root!.dominatedTargetKeys).toBeUndefined();
        expect(root!.opposingGateArmKeys).toBeUndefined();
        // Public board, same rule at every depth: it stands.
        expect(root!.dominatedBlockKeys).toEqual(new Set(["z"]));
    });

    it("refuses a node that is not this decision", () => {
        const { state, botId } = caseA();
        const passKey = treeKeyOf(state, botId, botId, { kind: "pass" })!;
        const foreign = node();
        foreign.children.set("nope", edge("nope", botId, node()));
        expect(adoptKeptRoot(foreign, state, botId, new Set())).toBeNull();
        const opponents = node();
        opponents.children.set(passKey, edge(passKey, "someone", node()));
        expect(adoptKeptRoot(opponents, state, botId, new Set())).toBeNull();
        const viewed = node();
        viewed.optionViews = new Map();
        expect(adoptKeptRoot(viewed, state, botId, new Set())).toBeNull();
    });
});

describe("the budget counts root visits", () => {
    it("a kept root holding visits runs only the rest of the budget", () => {
        const { state, botId } = caseA();
        const first = searchWithTrace(
            state,
            botId,
            { iterations: 120 },
            1,
            undefined,
            undefined,
            {}
        );
        expect(first.root).toBeDefined();
        const chosen = first.move!;
        const key = treeKeyOf(state, botId, botId, chosen)!;
        const subtree = first.root!.children.get(key)!.node;
        const next = structuredClone(state);
        applyMoveInSearch(next, botId, chosen);

        const second = searchWithTrace(
            next,
            botId,
            { iterations: 120 },
            2,
            undefined,
            undefined,
            {
                kept: subtree,
            }
        );
        const kept = second.trace!.iterationsKept!;
        expect(kept).toBeGreaterThan(0);
        expect(second.trace!.iterationsCompleted).toBe(120 - kept);
        expect(rootVisits(second.root!)).toBe(120);
    });

    it("a search without reuse returns no tree and keeps nothing", () => {
        const { state, botId } = caseA();
        const res = searchWithTrace(state, botId, { iterations: 40 }, 1);
        expect(res.root).toBeUndefined();
        expect(res.trace!.iterationsKept).toBe(0);
        expect(res.trace!.iterationsCompleted).toBe(40);
    });

    it("a starved root counts the visits it kept", () => {
        const stats = {
            iterationsCompleted: 2,
            iterationsRequested: 40,
            elapsedMs: 1,
            stoppedBy: "iterations" as const,
        };
        expect(rootIsStarved(4, stats)).toBe(true);
        expect(rootIsStarved(4, { ...stats, iterationsKept: 30 })).toBe(false);
    });
});

describe("handleBrainRequest keeps the tree between consults", () => {
    function consults(
        change: (
            req: Parameters<typeof handleBrainRequest>[0]
        ) => void = () => {}
    ): { first: number; second: number; keeper: TreeKeeper } {
        const { state, botId } = caseA();
        const keeper: TreeKeeper = { kept: null, catalogue: () => "c" };
        const ask = (
            s: GameState,
            seq: number,
            steps: { seat: string; key: string }[] | null
        ) =>
            handleBrainRequest(
                {
                    id: seq,
                    state: projectPublicState(s, seq, botId),
                    botId,
                    budget: { iterations: 120 },
                    seed: seq,
                    reuse: { gameId: "g", steps },
                },
                undefined,
                keeper
            );
        const one = ask(state, 1, []);
        expect(keeper.kept).not.toBeNull();
        const step = { seat: botId, key: moveKey(one.move!) };
        applyMoveInSearch(state, botId, one.move!);
        const req = {
            id: 2,
            state: projectPublicState(state, 2, botId),
            botId,
            budget: { iterations: 120 },
            seed: 2,
            reuse: {
                gameId: "g",
                steps: [step] as { seat: string; key: string }[] | null,
            },
        };
        change(req as Parameters<typeof handleBrainRequest>[0]);
        const two = handleBrainRequest(req, undefined, keeper);
        return {
            first: one.trace!.iterationsKept!,
            second: two.trace!.iterationsKept!,
            keeper,
        };
    }

    it("continues from the kept subtree after the Bot's own move", () => {
        const { first, second, keeper } = consults();
        expect(first).toBe(0);
        expect(second).toBeGreaterThan(0);
        // The second consult's tree is kept in turn.
        expect(keeper.kept).not.toBeNull();
    });

    it("searches fresh on another game, or a path it cannot name", () => {
        expect(
            consults((req) => {
                req.reuse = { gameId: "other", steps: req.reuse!.steps };
            }).second
        ).toBe(0);
        expect(
            consults((req) => {
                req.reuse = { gameId: "g", steps: null };
            }).second
        ).toBe(0);
    });

    it("without a reuse field nothing is kept", () => {
        const { state, botId } = caseA();
        const keeper: TreeKeeper = { kept: null, catalogue: () => "c" };
        handleBrainRequest(
            {
                id: 1,
                state: projectPublicState(state, 1, botId),
                botId,
                budget: { iterations: 40 },
                seed: 1,
            },
            undefined,
            keeper
        );
        expect(keeper.kept).toBeNull();
    });
});
