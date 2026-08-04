// Feasibility benchmark harness for the vs-AI brain (ADR 0001, issue #108).
//
// One ISMCTS iteration, modelled with stub moves: clone the (determinized) root
// state, run a truncated rollout of depth K applying cheap stub moves in place
// on the clone, then a dummy heuristic eval. This measures the clone + rollout
// throughput that gates the whole feature — the PRD requires ~1k–5k iter/sec on
// a mid-range device before the real search work proceeds.
//
// Stub moves stand in for the real `enumerateMoves`/executor (issue #110): the
// goal here is to measure the *cost of cloning and stepping the real GameState*,
// not move quality. Both a `cloneGameState` and a `structuredClone` variant are
// provided so the benchmark quantifies the structural-sharing speedup.

import { tryGetDefinition } from "../cards";
import { cloneGameState } from "./clone";
import type { CardInstanceState, GameState, PlayerState } from "./state";

/** Build a CardInstanceState from a registered definition id (engine persists
 *  only the slim `{ id }` ref; the rest hydrates from the registry). */
function instance(
    cardId: string,
    id: string,
    zone: CardInstanceState["zone"],
    controllerId: string
): CardInstanceState {
    const def = tryGetDefinition(cardId);
    return {
        id,
        card: { id: cardId },
        types: def?.types ? [...def.types] : ["Creature"],
        subtypes: def?.subtypes ? [...def.subtypes] : [],
        power: def?.power,
        toughness: def?.toughness,
        staticAbilities: def?.staticAbilities ? [...def.staticAbilities] : [],
        controllerId,
        ownerId: controllerId,
        zone,
        isTapped: false,
    };
}

/** The turn the bench position is staged on. Shared by `GameState.turn` and
 *  the `enteredOnTurn` entry stamp below so the two agree. */
const BENCH_TURN = 5;

/** A representative mid-game position: two players, full-ish libraries, a
 *  developed battlefield and a couple of cards in hand. Sized to resemble a
 *  real GameState so the clone cost is realistic. */
export function representativeBenchState(creatureCardId: string): GameState {
    const buildPlayer = (pid: string): PlayerState => ({
        id: pid,
        name: pid,
        bgColor: "#000",
        life: 20,
        hand: Array.from({ length: 5 }, (_, i) =>
            instance(creatureCardId, `${pid}-h-${i}`, "hand", pid)
        ),
        library: Array.from({ length: 30 }, (_, i) =>
            instance(creatureCardId, `${pid}-l-${i}`, "library", pid)
        ),
        graveyard: Array.from({ length: 3 }, (_, i) =>
            instance(creatureCardId, `${pid}-g-${i}`, "graveyard", pid)
        ),
        exile: [],
        battlefield: Array.from({ length: 6 }, (_, i) => ({
            ...instance(creatureCardId, `${pid}-b-${i}`, "battlefield", pid),
            // CR 302.6 / 400.7 — the two halves of the entry clock are written
            // TOGETHER (`markEnteredThisTurn`). Staging `isSummoningSick`
            // alone leaves an instance that is summoning-sick yet carries no
            // entry stamp, a state the engine itself never produces; gates
            // that read `enteredOnTurn` (Chaos Lord's conditional haste)
            // would then see "unknown" on a board the bench calls realistic.
            ...(i === 0
                ? { isSummoningSick: true, enteredOnTurn: BENCH_TURN }
                : {}),
            counters: i % 2 === 0 ? { "+1/+1": 1 } : undefined,
        })),
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    });

    return {
        players: [buildPlayer("p1"), buildPlayer("p2")],
        stack: [],
        turn: BENCH_TURN,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        passCount: 0,
        phase: "PRECOMBAT_MAIN",
        rngSeed: 12345,
        rngCounter: 0,
    };
}

/** A cheap stub move applied in place to a clone — stands in for a real macro
 *  move. Touches several deep-copied paths so the rollout actually exercises
 *  the clone's independence (taps a creature, bumps a counter, mutates life). */
function applyStubMove(state: GameState, step: number): void {
    const p = state.players[step % state.players.length];
    const bf = p.battlefield;
    if (bf.length > 0) {
        const c = bf[step % bf.length];
        c.isTapped = !c.isTapped;
        c.counters = { "+1/+1": (c.counters?.["+1/+1"] ?? 0) + 1 };
    }
    p.life -= 1;
    state.rngCounter = (state.rngCounter + 1) | 0;
}

/** A dummy heuristic eval — sums life + board power. Stands in for the real
 *  `evaluate` (issue #111); only its cost matters here. */
function dummyEval(state: GameState): number {
    let score = 0;
    for (const p of state.players) {
        score += p.life;
        for (const c of p.battlefield) score += c.power ?? 0;
    }
    return score;
}

export type BenchResult = {
    label: string;
    iterations: number;
    ms: number;
    iterPerSec: number;
    rolloutDepth: number;
};

export type BenchOptions = {
    /** Wall-clock budget for the loop, ms. */
    budgetMs?: number;
    /** Truncated-rollout depth K (stub moves applied per iteration). */
    rolloutDepth?: number;
    /** Clone strategy under test. */
    clone?: (s: GameState) => GameState;
    label?: string;
    /** Definition id of the creature filling the bench position. */
    creatureCardId: string;
    /** Monotonic clock (ms). Injectable for determinism in tests. */
    now?: () => number;
};

/** Runs `clone + truncated dummy rollout` in a loop for `budgetMs` and reports
 *  iterations/sec. One iteration = one clone + `rolloutDepth` stub moves + eval. */
export function runCloneRolloutBenchmark(opts: BenchOptions): BenchResult {
    const budgetMs = opts.budgetMs ?? 1000;
    const rolloutDepth = opts.rolloutDepth ?? 10;
    const clone = opts.clone ?? cloneGameState;
    const now = opts.now ?? (() => performance.now());
    const root = representativeBenchState(opts.creatureCardId);

    // Warm up JIT before timing.
    for (let w = 0; w < 50; w++) {
        const s = clone(root);
        for (let d = 0; d < rolloutDepth; d++) applyStubMove(s, d);
        dummyEval(s);
    }

    let iterations = 0;
    let sink = 0;
    const start = now();
    let elapsed = 0;
    // Check the clock in batches so `now()` overhead doesn't dominate.
    const BATCH = 64;
    do {
        for (let b = 0; b < BATCH; b++) {
            const s = clone(root);
            for (let d = 0; d < rolloutDepth; d++) applyStubMove(s, d);
            sink += dummyEval(s);
            iterations++;
        }
        elapsed = now() - start;
    } while (elapsed < budgetMs);

    if (sink === Number.MIN_SAFE_INTEGER) throw new Error("unreachable");

    return {
        label: opts.label ?? "cloneGameState",
        iterations,
        ms: elapsed,
        iterPerSec: Math.round((iterations / elapsed) * 1000),
        rolloutDepth,
    };
}
