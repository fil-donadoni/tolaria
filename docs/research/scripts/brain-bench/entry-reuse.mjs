// The tree-reuse bench payload (issue #10136): what a search's grown tree
// still holds at the Bot's NEXT decision. Bundle it with the root seam
// (`bundleBench(..., { rootHook: true })`); `run-reuse.mjs` builds it.
//
// One blade `must` entry, at its first declared seed:
//
//   1. the Bot searches its root at `iterations` (iterations-only, no clock)
//      and the root is captured (`captureNextRoot`);
//   2. the REAL position is walked forward from the root, through the tree,
//      with the search's own transition (`applyMoveInSearch`) and its own
//      keying (`keyedMovesFor`): the Bot's chosen move first, then — while the
//      opponent decides — the opponent's move, until the Bot decides again;
//   3. at every step the visits the tree holds under the move played are read
//      (an opponent node's visits are the sum over its option-set views,
//      issue #8939), so the last one is what a kept tree would hand the next
//      consult.
//
// The opponent's move is chosen three ways, each its own walk:
//
//   - `search`: a search for the opponent's seat at the same budget, on the
//     real position — a competent reply the Bot's tree did not choose;
//   - `tree`: the reply the Bot's tree visited most — the tree's own guess,
//     an upper bound on what a reply can leave;
//   - `pass`: `pass` wherever it is legal (else `search`'s move) — the
//     commonest human action.
//
// Nothing here changes the search: with no hook installed the patched bundle
// searches byte-identically to an unpatched one (`bundle.mjs`).

import { captureNextRoot } from "./ensemble.mjs";
import { bladeScenariosForTier } from "../../../../convex/gre/ai/blade/registry";
import {
    buildBladeState,
    bladeDeckKnowledge,
    DEFAULT_BLADE_SEED,
} from "../../../../convex/gre/ai/blade/runner";
import { seatPlayerId } from "../../../../convex/gre/ai/blade/matcher";
import {
    advanceToDecision,
    applyMoveInSearch,
    keyedMovesFor,
    moveKey,
    searchWithTrace,
} from "../../../../convex/gre/search";
import { cloneGameState } from "../../../../convex/gre/clone";

const MUST = bladeScenariosForTier("must");

/** Steps walked before giving up on the Bot deciding again. */
const MAX_STEPS = 8;

/** Iterations that passed through the child under `key` at `node`, and the
 *  child itself. A Bot node holds its edges in `children`; an opponent node
 *  holds them in its option-set views and its children in `childNodes`. */
function childOf(node, key, isBot) {
    if (!node) return { visits: 0, child: null };
    if (isBot) {
        const edge = node.children.get(key);
        return { visits: edge?.visits ?? 0, child: edge?.node ?? null };
    }
    let visits = node.children.get(key)?.visits ?? 0;
    for (const view of node.optionViews?.values() ?? []) {
        visits += view.children.get(key)?.visits ?? 0;
    }
    const child =
        node.childNodes?.get(key) ?? node.children.get(key)?.node ?? null;
    return { visits, child };
}

/** The opponent's reply the tree visited most at `node` (summed over views). */
function treeReplyKey(node) {
    const totals = new Map();
    const add = (edges) => {
        for (const [key, edge] of edges) {
            totals.set(key, (totals.get(key) ?? 0) + edge.visits);
        }
    };
    if (!node) return null;
    add(node.children);
    for (const view of node.optionViews?.values() ?? []) add(view.children);
    let best = null;
    for (const [key, visits] of totals) {
        if (!best || visits > best.visits) best = { key, visits };
    }
    return best?.key ?? null;
}

function handIds(state, pid) {
    return new Set(
        state.players.find((p) => p.id === pid)?.hand.map((c) => c.id) ?? []
    );
}

/**
 * Walk the real position from the root through the tree.
 *
 * @returns {{ steps: object[], reached: "bot" | "end" | "lost" | "cap",
 *             keptVisits: number, crossedTurn: boolean, botDrew: boolean }}
 */
function walk(root, state, botId, firstMove, reply, ctx) {
    const real = cloneGameState(state);
    const turn0 = state.turn;
    const hand0 = handIds(state, botId);
    let node = root;
    const steps = [];
    let keptVisits = ctx.total;
    for (let i = 0; i < MAX_STEPS; i++) {
        const pid = advanceToDecision(real);
        if (!pid) return { steps, reached: "end", keptVisits, ...ends() };
        const isBot = pid === botId;
        if (isBot && i > 0) {
            return { steps, reached: "bot", keptVisits, ...ends() };
        }
        const keyed = keyedMovesFor(real, pid, botId);
        let pick;
        if (i === 0) {
            const k = moveKey(firstMove);
            pick = keyed.find((e) => moveKey(e.move) === k);
        } else {
            pick = reply(real, pid, node, keyed);
        }
        if (!pick) return { steps, reached: "lost", keptVisits, ...ends() };
        const { visits, child } = childOf(node, pick.key, isBot);
        steps.push({
            mover: isBot ? "bot" : "opp",
            kind: pick.move.kind,
            visits,
            options: keyed.length,
        });
        keptVisits = visits;
        node = child;
        try {
            applyMoveInSearch(real, pid, pick.move);
        } catch {
            return { steps, reached: "lost", keptVisits, ...ends() };
        }
        if (!node || visits === 0) {
            // Off the tree: nothing below is kept, whatever is played next.
            keptVisits = 0;
        }
    }
    return { steps, reached: "cap", keptVisits, ...ends() };

    function ends() {
        const now = handIds(real, botId);
        return {
            crossedTurn: real.turn !== turn0,
            botDrew: [...now].some((id) => !hand0.has(id)),
        };
    }
}

/**
 * Run blade `must` entry `index` and walk the three replies.
 *
 * @param {number} index
 * @param {{ iterations: number }} options
 */
function reuse(index, { iterations }) {
    const scenario = MUST[index];
    const seed = scenario.seeds?.[0] ?? DEFAULT_BLADE_SEED;
    const state = buildBladeState(scenario);
    const botId = seatPlayerId(state, scenario.bot);
    const deck = bladeDeckKnowledge(state, scenario);
    let root = null;
    captureNextRoot((r) => {
        root = r;
    });
    const { move, trace } = searchWithTrace(
        state,
        botId,
        { iterations },
        seed,
        deck
    );
    // A search with no tree (forced move, mulligan, nothing to decide) never
    // reaches the hook; drop it so it cannot catch the opponent's search.
    delete globalThis.__benchRootHook;
    if (!move || !trace || !root) {
        return { index, label: scenario.label, searched: false };
    }
    const total = trace.iterationsCompleted;

    const searchReply = (real, pid, _node, keyed) => {
        const r = searchWithTrace(real, pid, { iterations }, seed, deck);
        if (!r.move) return keyed[0];
        const k = moveKey(r.move);
        return keyed.find((e) => moveKey(e.move) === k);
    };
    const treeReply = (real, pid, node, keyed) => {
        const key = treeReplyKey(node);
        return (
            keyed.find((e) => e.key === key) ??
            searchReply(real, pid, node, keyed)
        );
    };
    const passReply = (real, pid, node, keyed) =>
        keyed.find((e) => e.move.kind === "pass") ??
        searchReply(real, pid, node, keyed);

    const ctx = { total };
    return {
        index,
        label: scenario.label,
        searched: true,
        total,
        stoppedBy: trace.stoppedBy,
        candidates: trace.candidates.length,
        chosenVisits: trace.candidates.find((c) => c.label === trace.chosen)
            ?.visits,
        search: walk(root, state, botId, move, searchReply, ctx),
        tree: walk(root, state, botId, move, treeReply, ctx),
        pass: walk(root, state, botId, move, passReply, ctx),
    };
}

globalThis.__brainReuse = { count: MUST.length, reuse };
