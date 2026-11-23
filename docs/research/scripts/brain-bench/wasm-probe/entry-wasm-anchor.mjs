// The probe kernel's anchor (issue #10471): arm A beside the ENGINE's own
// rollout-policy probe on the same board shape, so the note can say how much
// of the real probe the kernel stands for. Bundled with the engine by
// `run-wasm-probe.mjs build`; it exposes `globalThis.__wasmAnchor`.
//
// Each kernel board is lowered to real cards (`boards.mjs`, `anchorSpec`) and
// built by the engine's own scenario builder. The real probe is
// `selectRolloutMove` over the engine's own enumeration of that position: it
// clones the state, applies the candidate, settles and evaluates, once per
// candidate — the loop `docs/research/rollout-policy-cost.md` § 1 measures at
// 62–73% of a field search. Three of its parts are also timed alone, on the
// same state: the clone, one state-based-action check of a fresh clone, and
// one evaluation.
//
//   init()                      build the boards; per board, what the engine
//                               made of it
//   sample(kind, board, reps)   time `reps` rounds of `kind`:
//                               `real` the engine's probes, `clone`, `sba`
//                               (clone + check), `evaluate`, or `A` (arm A)

import { buildPositionFromSpec } from "../../../../../convex/gre/ai/blade/build";
import { cloneGameState } from "../../../../../convex/gre/clone";
import { evaluate } from "../../../../../convex/gre/evaluate";
import { enumerateMoves } from "../../../../../convex/gre/moves";
import { checkStateBasedActions } from "../../../../../convex/gre/sba";
import {
    decidingPlayer,
    selectRolloutMove,
} from "../../../../../convex/gre/search";
import { anchorSpec, buildBoards } from "./boards.mjs";
import { createObjectKernel } from "./kernel-objects.mjs";

const boards = buildBoards();
let anchors = [];

/** How many objects and arrays `cloneGameState` allocates for `state`: the
 *  walk `convex/gre/clone.ts` makes, counted. */
function cloneObjects(state) {
    const SHARED = new Set([
        "types",
        "subtypes",
        "staticAbilities",
        "baseTypes",
        "baseSubtypes",
        "baseStaticAbilities",
    ]);
    let objects = 0;
    const walk = (value, key) => {
        if (value === null || typeof value !== "object") return;
        if (key === "card" && !("card" in value)) return;
        if (SHARED.has(key) && Array.isArray(value)) return;
        objects++;
        if (Array.isArray(value)) value.forEach((v) => walk(v));
        else Object.keys(value).forEach((k) => walk(value[k], k));
    };
    walk(state);
    return objects;
}

function init() {
    anchors = boards.map((board) => {
        const state = buildPositionFromSpec(
            anchorSpec(board),
            undefined,
            board.label
        );
        const pid = decidingPlayer(state) ?? state.activePlayerId;
        const moves = enumerateMoves(state, pid);
        const A = createObjectKernel();
        A.load(board);
        return { state, pid, moves, A, n: board.moves.length };
    });
    return anchors.map(({ state, pid, moves, A, n }, i) => ({
        label: boards[i].label,
        permanents: state.players.reduce(
            (sum, p) => sum + p.battlefield.length,
            0
        ),
        library: state.players.map((p) => p.library.length),
        decides: pid === state.activePlayerId ? "active" : "other",
        candidates: moves.length,
        kinds: moves.reduce((count, m) => {
            count[m.kind] = (count[m.kind] ?? 0) + 1;
            return count;
        }, {}),
        cloneObjects: cloneObjects(state),
        kernelCandidates: n,
        kernelCloneObjects: A.cloneSize(),
    }));
}

function sample(kind, index, reps) {
    const { state, pid, moves, A, n } = anchors[index];
    // The policy's tie-break only; a fixed stream keeps every round the same.
    const rng = () => 0.5;
    let sink = 0;
    const t0 = performance.now();
    if (kind === "real") {
        for (let r = 0; r < reps; r++) {
            sink += selectRolloutMove(state, pid, pid, moves, rng) ? 1 : 0;
        }
    } else if (kind === "clone") {
        for (let r = 0; r < reps * moves.length; r++) {
            sink += cloneGameState(state).turn;
        }
    } else if (kind === "sba") {
        for (let r = 0; r < reps * moves.length; r++) {
            const probe = cloneGameState(state);
            checkStateBasedActions(probe);
            sink += probe.turn;
        }
    } else if (kind === "evaluate") {
        for (let r = 0; r < reps * moves.length; r++) {
            sink += evaluate(state, pid);
        }
    } else if (kind === "A") {
        sink = A.run(n, reps);
    } else {
        throw new Error(`unknown kind ${kind}`);
    }
    const ms = performance.now() - t0;
    return {
        ms,
        probes: reps * (kind === "A" ? n : moves.length),
        sink,
    };
}

globalThis.__wasmAnchor = { init, sample };
