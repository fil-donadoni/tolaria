// The rollout-policy prototypes (issue #10134): candidate default policies
// for the rollout, installed through the seam `bundle.mjs` patches into the
// bundled search (`rolloutHook`), and the counters every arm reads. Never the
// default: the source tree's `selectRolloutMove` is untouched, and with no
// policy installed the bundle plays today's greedy pick.
//
// A policy is a string:
//
//   base        today's policy: the greedy 1-ply pick probes EVERY candidate
//               (clone + apply + settle + evaluate), then plays the best
//   topk:K      a static per-move-kind score ranks the candidates and only
//               the best K (pass always among them) are probed
//   prefix:N    the greedy pick for a rollout's first N greedy plies; every
//               later ply plays a uniform-random candidate, no probe
//   cap:N       today's policy, the rollout cut after N plies and closed by
//               the evaluation (`scoreLeaf`) — the ADR 0015 horizon kept
//               where it comes sooner
//   memo        today's policy, the pick memoised by the ply's exact state
//               and candidates: a recurring ply plays the move it played
//               before, without a probe
//   memo-public the same memo keyed without the libraries: a ply that recurs
//               up to the hidden library order plays the move it played
//   memo-count  today's policy, unchanged: only counts how often the memo's
//               key recurs (an exact key, and one that ignores libraries)
//   reseed      today's policy on ANOTHER RANDOM STREAM: one extra draw
//               before every rollout. The noise control — the decisions that
//               move with nothing but the playouts' dice
//
// The counters: rollouts, plies (forced passes, and played moves with the
// candidates each was chosen from), greedy picks (the probing plies) and
// their candidates, plies per rollout.

import { moveKey } from "../../../../convex/gre/search";

/** The static per-move-kind score `topk` ranks by: what kind of move it is,
 *  never what the move does. Higher first; ties keep enumeration order. */
const KIND_SCORE = {
    "play-land": 6,
    "cast-spell": 5,
    "activate-ability": 4,
    "activate-granted-ability": 4,
    "declare-attackers": 4,
    "declare-blockers": 4,
    "turn-face-up": 3,
    foretell: 3,
    plot: 3,
    "summon-companion": 3,
    pass: 0,
};

function staticScore(move) {
    if (
        (move.kind === "declare-attackers" &&
            (move.attackerIds?.length ?? 0) === 0) ||
        (move.kind === "declare-blockers" &&
            (move.assignments?.length ?? 0) === 0)
    ) {
        return 1;
    }
    return KIND_SCORE[move.kind] ?? 2;
}

/** The best `k` of `moves` by `staticScore`, `pass` always kept. */
function topK(moves, k) {
    if (moves.length <= k) return moves;
    const pass = moves.find((m) => m.kind === "pass");
    const ranked = moves
        .map((m, i) => ({ m, i, s: staticScore(m) }))
        .filter(({ m }) => m !== pass)
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .slice(0, pass ? k - 1 : k)
        .map(({ m }) => m);
    return pass ? [pass, ...ranked] : ranked;
}

const counters = newCounters();
let inRollout = false;
let greedyThisRollout = 0;
let pliesThisRollout = 0;
let memo = new Map();
const memoSeen = { exact: new Set(), public: new Set() };

function newCounters() {
    return {
        rollouts: 0,
        forcedPlies: 0,
        playedPlies: 0,
        playedCandidates: 0,
        greedyPicks: 0,
        greedyCandidates: 0,
        probesSkipped: 0,
        plies: [],
        memoKeys: 0,
        memoExactHits: 0,
        memoPublicHits: 0,
        memoServed: 0,
    };
}

/** Zero the counters and the memo: one search's reading starts here. */
export function resetCounters() {
    Object.assign(counters, newCounters());
    memo = new Map();
    memoSeen.exact.clear();
    memoSeen.public.clear();
}

export function readCounters() {
    return { ...counters, plies: [...counters.plies] };
}

const dropLibraries = (key, value) => (key === "library" ? undefined : value);

/** The memo's key for one greedy ply: the whole state, the mover and the
 *  candidates (`public`: the libraries left out). */
function plyKey(state, pid, moves, replacer) {
    return `${pid}|${moves.map(moveKey).join(";")}|${JSON.stringify(state, replacer)}`;
}

/** Install `policy` (the strings above) for every later search. */
export function installPolicy(policy) {
    const [name, arg] = policy.split(":");
    const n = Number(arg);
    globalThis.__benchMaxPlies = name === "cap" ? n : undefined;
    globalThis.__benchPly = (kind, candidates) => {
        if (!inRollout) return;
        pliesThisRollout += 1;
        if (kind === "forced") counters.forcedPlies += 1;
        else {
            counters.playedPlies += 1;
            counters.playedCandidates += candidates;
        }
    };
    globalThis.__benchRollout = (inner, args) => {
        // `rollout(state, botId, rng, …)`: the search's own stream.
        if (name === "reseed") args[2]();
        inRollout = true;
        greedyThisRollout = 0;
        pliesThisRollout = 0;
        try {
            return inner(...args);
        } finally {
            inRollout = false;
            counters.rollouts += 1;
            counters.plies.push(pliesThisRollout);
        }
    };
    globalThis.__benchPolicy = (inner, args) => {
        // The greedy pick outside a rollout (a measurement seam such as
        // `greedyRootPick`) is not the rollout policy: left alone.
        if (!inRollout) return inner(...args);
        const [state, pid, , moves, rng] = args;
        greedyThisRollout += 1;
        if (name === "prefix" && greedyThisRollout > n) {
            counters.probesSkipped += moves.length;
            return moves[Math.floor(rng() * moves.length)];
        }
        if (name === "topk") {
            const kept = topK(moves, n);
            counters.probesSkipped += moves.length - kept.length;
            counters.greedyPicks += 1;
            counters.greedyCandidates += kept.length;
            const next = [...args];
            next[3] = kept;
            return inner(...next);
        }
        if (
            name === "memo" ||
            name === "memo-public" ||
            name === "memo-count"
        ) {
            const exact = plyKey(
                state,
                pid,
                moves,
                name === "memo-public" ? dropLibraries : undefined
            );
            counters.memoKeys += 1;
            if (name === "memo-count") {
                const pub = plyKey(state, pid, moves, dropLibraries);
                if (memoSeen.exact.has(exact)) counters.memoExactHits += 1;
                else memoSeen.exact.add(exact);
                if (memoSeen.public.has(pub)) counters.memoPublicHits += 1;
                else memoSeen.public.add(pub);
            } else {
                const known = memo.get(exact);
                const hit = known && moves.find((m) => moveKey(m) === known);
                if (hit) {
                    counters.memoServed += 1;
                    counters.probesSkipped += moves.length;
                    return hit;
                }
            }
            counters.greedyPicks += 1;
            counters.greedyCandidates += moves.length;
            const chosen = inner(...args);
            if (name !== "memo-count") memo.set(exact, moveKey(chosen));
            return chosen;
        }
        counters.greedyPicks += 1;
        counters.greedyCandidates += moves.length;
        return inner(...args);
    };
}
