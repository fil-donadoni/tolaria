// Pondering (issue #10472, ADR 0185 Amendment I): the kept tree re-rooted at
// the human's decision and grown there, the consult that continues past the
// ponder's prefix, and the trace's account of what pondering grew.

import { describe, expect, it } from "vitest";
import { projectPublicState } from "../../../gameProjections";
import {
    advanceToDecision,
    applyMoveInSearch,
    rootVisits,
    treeKeyOf,
    type Edge,
    type Node,
} from "../../search";
import { enumerateMoves, type Move } from "../../moves";
import type { GameState } from "../../state";
import { handleBrainRequest, type TreeKeeper } from "../brainRequest";
import { buildPositionFromSpec } from "../blade/build";
import { seatPlayerId } from "../blade/matcher";
import { bladeDeckKnowledge } from "../blade/runner";
import { BLADE_SEQUENCES } from "../blade/sequences";
import { startPonder } from "../ponder";
import { projectedToGameState } from "../stateAdapter";
import {
    continueKeptTree,
    type ConsultPathStep,
    type KeptTree,
} from "../treeReuse";

const GAME = "ponder-test";

const ENTRY = BLADE_SEQUENCES.find((e) => e.ponder)!;

function keeper(): TreeKeeper {
    return { kept: null, catalogue: () => "test" };
}

function stepFor(
    state: GameState,
    seq: number,
    pid: string,
    botId: string,
    move: Move
): ConsultPathStep {
    const view = projectedToGameState(
        projectPublicState(state, seq, pid),
        undefined,
        pid
    );
    return { seat: pid, key: treeKeyOf(view, pid, botId, move)! };
}

/** The pondering blade entry's board: the Bot's first consult kept a tree,
 *  and the game stands at the human's first real choice after it. */
function atHumanChoice() {
    const state = buildPositionFromSpec(ENTRY.spec, undefined, ENTRY.label);
    const botId = seatPlayerId(state, ENTRY.bot);
    const deckKnowledge = bladeDeckKnowledge(state, ENTRY);
    const k = keeper();
    let seq = 1;
    const first = handleBrainRequest(
        {
            id: seq,
            state: projectPublicState(state, seq, botId),
            botId,
            budget: { iterations: 200 },
            deckKnowledge,
            seed: 7,
            reuse: { gameId: GAME, steps: [] },
        },
        undefined,
        k
    );
    const steps: ConsultPathStep[] = [
        stepFor(state, seq, botId, botId, first.move!),
    ];
    applyMoveInSearch(state, botId, first.move!);
    let human = advanceToDecision(state)!;
    while (human !== botId) {
        seq++;
        // The entry's pondered choice: the first with more than one move.
        if (enumerateMoves(state, human).length > 1) break;
        steps.push(stepFor(state, seq, human, botId, { kind: "pass" }));
        applyMoveInSearch(state, human, { kind: "pass" });
        human = advanceToDecision(state)!;
    }
    return { state, botId, deckKnowledge, keeper: k, seq, steps, human };
}

describe("startPonder", () => {
    it("re-roots the kept tree at the human's decision and grows it there", () => {
        const at = atHumanChoice();
        const grownBefore = at.keeper.kept!.root;
        const session = startPonder(
            {
                kind: "ponder",
                state: projectPublicState(at.state, at.seq, at.botId),
                botId: at.botId,
                deckKnowledge: at.deckKnowledge,
                reuse: { gameId: GAME, steps: at.steps },
                seed: 3,
            },
            at.keeper
        );
        expect(session).not.toBeNull();
        // The subtree under the Bot's move, not a fresh node.
        expect(session!.continued).toBe(true);
        const kept = at.keeper.kept!;
        expect(kept.root).not.toBe(grownBefore);
        expect(kept.prefix).toEqual(at.steps);
        expect(kept.root.children.size).toBe(0);

        const nodesBefore = session!.nodes();
        expect(session!.slice(50)).toBe(50);
        expect(kept.ponder!.iterations).toBe(50);
        // The human's node selects through its option-set views.
        let visits = 0;
        kept.root.optionViews!.forEach((view) =>
            view.children.forEach((e: Edge) => (visits += e.visits))
        );
        expect(visits).toBeGreaterThanOrEqual(50);
        expect(session!.nodes()).toBeGreaterThan(nodesBefore);
    });

    it("ponders nothing at the Bot's own decision: that is a consult's", () => {
        const state = buildPositionFromSpec(ENTRY.spec, undefined, ENTRY.label);
        const botId = seatPlayerId(state, ENTRY.bot);
        const k = keeper();
        const session = startPonder(
            {
                kind: "ponder",
                state: projectPublicState(state, 1, botId),
                botId,
                reuse: { gameId: GAME, steps: [] },
            },
            k
        );
        expect(session).toBeNull();
        expect(k.kept).toBeNull();
    });

    it("ponders a fresh tree when the path left the kept one", () => {
        const at = atHumanChoice();
        const session = startPonder(
            {
                kind: "ponder",
                state: projectPublicState(at.state, at.seq, at.botId),
                botId: at.botId,
                deckKnowledge: at.deckKnowledge,
                reuse: {
                    gameId: GAME,
                    steps: [{ seat: at.botId, key: "never-played" }],
                },
                seed: 3,
            },
            at.keeper
        );
        expect(session!.continued).toBe(false);
        expect(rootVisits(at.keeper.kept!.root)).toBe(0);
        expect(session!.slice(10)).toBe(10);
    });

    it("stops growing a tree a consult has taken", () => {
        const at = atHumanChoice();
        const session = startPonder(
            {
                kind: "ponder",
                state: projectPublicState(at.state, at.seq, at.botId),
                botId: at.botId,
                deckKnowledge: at.deckKnowledge,
                reuse: { gameId: GAME, steps: at.steps },
                seed: 3,
            },
            at.keeper
        );
        at.keeper.kept = null;
        expect(session!.live()).toBe(false);
        expect(session!.slice(10)).toBe(0);
    });
});

describe("continueKeptTree past a ponder's prefix", () => {
    function pondered(): KeptTree {
        const leaf: Node = { children: new Map() };
        const root: Node = {
            children: new Map(),
            childNodes: new Map([["h", leaf]]),
            optionViews: new Map(),
        };
        return {
            gameId: GAME,
            botId: "bot",
            catalogue: "c",
            root,
            projection: projectPublicState(
                buildPositionFromSpec(ENTRY.spec, undefined, ENTRY.label),
                1,
                "x"
            ),
            prefix: [{ seat: "bot", key: "a" }],
        };
    }
    const context = { gameId: GAME, botId: "bot", catalogue: "c" };

    it("walks only the steps past the prefix", () => {
        const kept = pondered();
        const result = continueKeptTree(
            kept,
            context,
            [
                { seat: "bot", key: "a" },
                { seat: "human", key: "h" },
            ],
            kept.projection
        );
        expect(result).toEqual({ node: kept.root.childNodes!.get("h") });
    });

    it("drops the tree when the path does not start with the prefix", () => {
        const kept = pondered();
        expect(
            continueKeptTree(
                kept,
                context,
                [
                    { seat: "bot", key: "b" },
                    { seat: "human", key: "h" },
                ],
                kept.projection
            )
        ).toEqual({ dropped: "mismatch" });
    });

    it("lets a ponder stand on the prefix itself, never a consult", () => {
        const kept = pondered();
        const steps = [{ seat: "bot", key: "a" }];
        expect(
            continueKeptTree(kept, context, steps, kept.projection, true)
        ).toEqual({ node: kept.root });
    });
});

describe("the consult after a ponder", () => {
    it("states the iterations pondered and the visits they grew at its root", () => {
        const at = atHumanChoice();
        const session = startPonder(
            {
                kind: "ponder",
                state: projectPublicState(at.state, at.seq, at.botId),
                botId: at.botId,
                deckKnowledge: at.deckKnowledge,
                reuse: { gameId: GAME, steps: at.steps },
                seed: 3,
            },
            at.keeper
        );
        session!.slice(200, undefined, () => 0);
        const steps = [
            ...at.steps,
            stepFor(at.state, at.seq, at.human, at.botId, { kind: "pass" }),
        ];
        applyMoveInSearch(at.state, at.human, { kind: "pass" });
        expect(advanceToDecision(at.state)).toBe(at.botId);
        const seq = at.seq + 1;
        const res = handleBrainRequest(
            {
                id: seq,
                state: projectPublicState(at.state, seq, at.botId),
                botId: at.botId,
                budget: { iterations: 200 },
                deckKnowledge: at.deckKnowledge,
                seed: 9,
                reuse: { gameId: GAME, steps },
            },
            undefined,
            at.keeper
        );
        const ponder = res.trace!.ponder!;
        expect(ponder.iterations).toBe(200);
        expect(ponder.kept).toBeGreaterThan(0);
        expect(ponder.kept).toBeLessThanOrEqual(res.trace!.iterationsKept!);
        // The budget counts root visits: what pondering grew is not re-run.
        expect(
            res.trace!.iterationsCompleted + res.trace!.iterationsKept!
        ).toBeLessThanOrEqual(200);
        // The next consult's tree has no ponder of its own.
        expect(at.keeper.kept!.ponder).toBeUndefined();
        expect(at.keeper.kept!.prefix).toBeUndefined();
    });
});
