// The leaf-parallel driver (issue #10450): ONE tree, its rollouts handed to
// helper Workers. Runs inside a bundle built with the leaf seam
// (`bundleBench(..., { leafHook: true })`), which routes every rollout the
// descent asks for through `__benchLeaf`.
//
// The batch rule. Leaf n is descended, a VIRTUAL LOSS is put on its path
// (each edge one visit at reward 0 for its mover, so the next descents steer
// round it), and its rollout is dispatched. Once K leaves are in flight the
// OLDEST is settled: its virtual loss taken off, its real reward
// backpropagated. So leaf n is chosen without the results of the K − 1
// before it, and rewards are applied in DISPATCH order whatever order the
// helpers answer in: a fixed (seed, K) grows the same tree. K = 1 is the
// search of K = 0 with one helper doing its rollouts one at a time — the
// hand-off cost alone, nothing gained.
//
// The LAG L (default K) is how many leaves may be in flight: the tree only
// ever depends on L, never on how many helpers run them. L > K lets the
// coordinator keep descending while the oldest leaf's rollout is a long one
// and the other helpers stand idle (head-of-line blocking); the one-thread
// quality runs read L as their K.
//
// Under the seam each leaf's rollout draws from its OWN generator (one u32
// drawn from the search's stream at dispatch) and each iteration's world from
// its own (one u32 drawn before `determinize`), so where a rollout runs cannot
// change what it returns. That re-seeding alone is the `K = 0, seeded` arm:
// today's search on other dice, the control every K is read against.
//
// Two transports for the helper's world:
//   - `clone`: the determinized world itself, structured-cloned per rollout;
//   - `replay`: the root state ONCE per search, then per rollout the world's
//     seed and the moves the descent applied — the helper determinizes the
//     same world and replays the path itself.
//
// An executor carries the rollouts: `localExecutor` runs them in this thread
// at settle time (the quality runs, the checks); the browser bench's Worker
// glue supplies one over SharedArrayBuffer (`run-leaf-browsers.mjs`).

const U32 = 4294967296;

let config = null; // { K, transport, executor }
let current = null; // the search in progress
let iteration = null; // the iteration in progress: { worldSeed, trail }
let lastLog = null; // the last search's settle log, for the determinism hash

const api = () => globalThis.__benchSearchApi;

/** The helper's side: one rollout from what crossed the boundary. `ctx` is
 *  the search's context (`beginSearch`), `job` the payload of `dispatch`. */
export function helperRollout(ctx, job) {
    const {
        rollout,
        determinize,
        makeRng,
        advanceToDecision,
        applyMoveInSearch,
    } = api();
    let world = job.world;
    let replayMs = 0;
    if (!world) {
        const t0 = performance.now();
        world = determinize(
            ctx.rootState,
            ctx.botId,
            makeRng(job.worldSeed),
            ctx.deckKnowledge,
            ctx.opponentModel
        );
        for (const [pid, move] of job.trail) {
            advanceToDecision(world);
            applyMoveInSearch(world, pid, move);
        }
        replayMs = performance.now() - t0;
    }
    const t1 = performance.now();
    const leaf = rollout(
        world,
        ctx.botId,
        makeRng(job.seed),
        ctx.weights,
        ctx.since
    );
    return {
        reward: leaf.reward,
        margin: leaf.margin,
        replayMs,
        rolloutMs: performance.now() - t1,
    };
}

/** Runs every rollout in this thread, when it is settled. `check` also
 *  replays the world from its seed and path and rolls out a structured clone
 *  of it, and throws unless all three rollouts agree: the two transports
 *  hand a helper the same world. */
export function localExecutor({ check = false } = {}) {
    let ctx = null;
    const jobs = new Map();
    const stats = { checked: 0 };
    return {
        stats,
        beginSearch(c) {
            ctx = c;
        },
        dispatch(n, job) {
            jobs.set(
                n,
                check ? { ...job, cloned: structuredClone(job.world) } : job
            );
        },
        wait(n) {
            const job = jobs.get(n);
            jobs.delete(n);
            if (!check) return helperRollout(ctx, job);
            const replayed = helperRollout(ctx, {
                worldSeed: job.worldSeed,
                trail: job.trail,
                seed: job.seed,
            });
            const cloned = helperRollout(ctx, {
                world: job.cloned,
                seed: job.seed,
            });
            const own = helperRollout(ctx, {
                world: job.world,
                seed: job.seed,
            });
            for (const other of [replayed, cloned]) {
                if (
                    other.reward !== own.reward ||
                    other.margin !== own.margin
                ) {
                    throw new Error(
                        `leaf ${n}: transports disagree (${own.reward}/${own.margin} vs ${other.reward}/${other.margin})`
                    );
                }
            }
            stats.checked++;
            return own;
        },
        drop(n) {
            jobs.delete(n);
        },
        endSearch() {},
    };
}

function settle(job) {
    const r = config.executor.wait(job.n);
    const { path, botId } = job;
    for (let i = 0; i < path.length; i++) path[i].visits -= 1;
    api().backpropagate(path, r, botId);
    current.log.push(job.n, r.reward, r.margin);
    current.settled++;
}

function onIterStart(rootState, botId, deckKnowledge, opponentModel) {
    if (!current || current.rootState !== rootState) {
        current = {
            rootState,
            botId,
            deckKnowledge,
            opponentModel,
            begun: false,
            dispatched: 0,
            settled: 0,
            pending: [],
            log: [],
        };
    }
    iteration = { worldSeed: 0, trail: [] };
}

function worldRng(rng) {
    iteration.worldSeed = (rng() * U32) >>> 0;
    return api().makeRng(iteration.worldSeed);
}

function onTrail(pid, move) {
    iteration.trail.push([pid, move]);
}

function onLeaf(path, world, botId, rng, weights, since) {
    const seed = (rng() * U32) >>> 0;
    const s = current;
    if (!s.begun) {
        s.begun = true;
        config.executor.beginSearch({
            rootState: s.rootState,
            botId,
            deckKnowledge: s.deckKnowledge,
            opponentModel: s.opponentModel,
            weights,
            since,
            transport: config.transport,
        });
    }
    const n = s.dispatched++;
    if (config.K === 0) {
        const { rollout, makeRng, backpropagate } = api();
        const leaf = rollout(world, botId, makeRng(seed), weights, since);
        backpropagate(path, leaf, botId);
        s.log.push(n, leaf.reward, leaf.margin);
        s.settled++;
        return;
    }
    for (let i = 0; i < path.length; i++) path[i].visits += 1;
    config.executor.dispatch(
        n,
        config.transport === "replay"
            ? { worldSeed: iteration.worldSeed, trail: iteration.trail, seed }
            : {
                  world,
                  seed,
                  worldSeed: iteration.worldSeed,
                  trail: iteration.trail,
              }
    );
    s.pending.push({ n, path: path.slice(), botId });
    if (s.pending.length >= (config.L ?? config.K)) settle(s.pending.shift());
}

/** After the loop: settle what is in flight — or, when the clock stopped the
 *  search, DROP it (virtual loss off, nothing backpropagated: a decision is
 *  never late for a helper) and return how many were dropped. */
function onDrain(stoppedBy) {
    const s = current;
    current = null;
    iteration = null;
    if (!s) return 0;
    let dropped = 0;
    while (s.pending.length > 0) {
        const job = s.pending.shift();
        if (stoppedBy === "time") {
            for (let i = 0; i < job.path.length; i++) job.path[i].visits -= 1;
            config.executor.drop(job.n);
            dropped++;
        } else {
            current = s;
            settle(job);
            current = null;
        }
    }
    config.executor.endSearch();
    lastLog = {
        dispatched: s.dispatched,
        settled: s.settled,
        dropped,
        log: s.log,
    };
    return dropped;
}

/** Install the batch for every search that follows (`null`: today's search,
 *  no seam active). `K` = leaves in flight; `transport` = `clone` | `replay`. */
export function installLeaf(next) {
    config = next;
    lastLog = null;
    current = null;
    iteration = null;
    const on = next !== null;
    globalThis.__benchLeaf = on ? onLeaf : undefined;
    globalThis.__benchIterStart = on ? onIterStart : undefined;
    globalThis.__benchWorldRng = on ? worldRng : undefined;
    globalThis.__benchTrail = on ? onTrail : undefined;
    globalThis.__benchDrain = on ? onDrain : undefined;
}

/** The last search's settle log folded to one 32-bit hash: two searches that
 *  applied the same rewards in the same order print the same hash. */
export function lastSettleHash() {
    if (!lastLog) return null;
    let h = 0x811c9dc5;
    const f = new Float64Array(1);
    const b = new Uint8Array(f.buffer);
    for (const v of lastLog.log) {
        f[0] = v;
        for (let i = 0; i < 8; i++) h = Math.imul(h ^ b[i], 0x01000193);
    }
    return {
        hash: (h >>> 0).toString(16),
        dispatched: lastLog.dispatched,
        settled: lastLog.settled,
        dropped: lastLog.dropped,
    };
}
