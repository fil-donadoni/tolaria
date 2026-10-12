import { describe, it, expect } from "vitest";
import {
    EMPTY_CADENCE,
    FIRE_DEDUP_MS,
    LANDINGS_PER_BATCH,
    MAX_BATCH_AGE_MS,
    MAX_PENDING_MS,
    healthRunnerMode,
    parseHealthRunnerConfig,
    remoteCadenceDecision,
    runnerPlan,
    type BaseCommit,
    type CadenceState,
} from "../lib/health-cadence";
import {
    lineageOf,
    type Verdict,
    type VerdictStore,
} from "../lib/health-verdict-store";
import {
    EMPTY_RUNNER_STATE,
    parseCommitLines,
    parseRunnerState,
    runnerTick,
    type RunnerDeps,
    type RunnerState,
} from "../lib/health-runner";

/**
 * The health runner (issue #5467, ADR 0154 §9): the cadence rule rebuilt from
 * the verdict store and git on the machine that gates, and the MacBook's
 * stale-verdict fallback. Same fixtures as `health-cadence.test.ts` — a count,
 * a clock, hand-built shas — so the runner is proven to apply the SAME rule.
 */

const T0 = Date.parse("2026-09-17T09:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;

const sha = (n: number) => String(n).padStart(40, "0");
const BASE = "b".repeat(40);
const RED_SHA = "e".repeat(40);

/** `n` base commits after the gated tip, one every `everyMs`, the first at `T0`. */
function commits(n: number, everyMs = 5 * MIN): BaseCommit[] {
    return Array.from({ length: n }, (_, i) => ({
        sha: sha(i + 1),
        at: T0 + i * everyMs,
    }));
}

const green = (s = BASE, at = T0 - HOUR): Verdict => ({
    sha: s,
    status: "green",
    machine: "huawei",
    at: new Date(at).toISOString(),
});
const red = (s = RED_SHA, at = T0 - HOUR): Verdict => ({
    sha: s,
    status: "red",
    step: "test:app",
    machine: "huawei",
    at: new Date(at).toISOString(),
});
const amber = (s: string, repairOf = RED_SHA): Verdict => ({
    sha: s,
    status: "amber",
    repairOf,
    at: new Date(T0).toISOString(),
});

describe("health runner — the plan is the cadence rule (issue #5467)", () => {
    it("fires by COUNT once a full batch sits on the last GREEN", () => {
        const c = commits(LANDINGS_PER_BATCH);
        const plan = runnerPlan({
            tip: c[c.length - 1].sha,
            lineage: lineageOf([green()]),
            commits: c,
            lastFire: null,
            now: T0 + 2 * HOUR,
        });
        expect(plan).toMatchObject({ kind: "fire", trigger: "count" });
    });

    it("holds while the batch is neither full nor old", () => {
        const c = commits(LANDINGS_PER_BATCH - 1);
        const plan = runnerPlan({
            tip: c[c.length - 1].sha,
            lineage: lineageOf([green()]),
            commits: c,
            lastFire: null,
            now: T0 + 2 * HOUR,
        });
        expect(plan.kind).toBe("hold");
    });

    it("fires by AGE when the oldest landing since the GREEN is 8 h old", () => {
        const c = commits(2);
        const plan = runnerPlan({
            tip: c[1].sha,
            lineage: lineageOf([green()]),
            commits: c,
            lastFire: null,
            now: T0 + MAX_BATCH_AGE_MS,
        });
        expect(plan).toMatchObject({ kind: "fire", trigger: "age" });
    });

    it("skips a tip it already started health on, within the dedup window", () => {
        const c = commits(LANDINGS_PER_BATCH);
        const tip = c[c.length - 1].sha;
        const input = {
            tip,
            lineage: lineageOf([green()]),
            commits: c,
            now: T0 + 2 * HOUR,
        };
        expect(
            runnerPlan({
                ...input,
                lastFire: { sha: tip, at: input.now - 10 * MIN },
            })
        ).toMatchObject({
            kind: "hold",
            reason: expect.stringContaining("already started"),
        });
        // The dedup expires: a run that never wrote a verdict is re-fired.
        expect(
            runnerPlan({
                ...input,
                lastFire: { sha: tip, at: input.now - FIRE_DEDUP_MS },
            }).kind
        ).toBe("fire");
    });

    it("holds behind a run already in flight on this machine", () => {
        const c = commits(LANDINGS_PER_BATCH);
        expect(
            runnerPlan({
                tip: c[c.length - 1].sha,
                lineage: lineageOf([green()]),
                commits: c,
                lastFire: null,
                pending: "a health run on 00000001 is already in flight",
                now: T0 + 2 * HOUR,
            }).kind
        ).toBe("hold");
    });

    it("holds when the tip IS the last GREEN", () => {
        expect(
            runnerPlan({
                tip: BASE,
                lineage: lineageOf([green()]),
                commits: [],
                lastFire: null,
                now: T0 + 10 * HOUR,
            }).kind
        ).toBe("hold");
    });

    it("fires a proved repair FIRST: the AMBER landing on a RED lineage, one young landing", () => {
        const c = commits(3);
        // Newest first: the AMBER repair, then the RED it repairs.
        const lineage = lineageOf([amber(c[1].sha), red()]);
        expect(lineage.kind).toBe("amber");
        const plan = runnerPlan({
            tip: c[2].sha,
            lineage,
            commits: c,
            lastFire: { sha: RED_SHA, at: T0 - 2 * HOUR },
            now: T0 + 20 * MIN,
        });
        expect(plan).toMatchObject({ kind: "fire", trigger: "repair" });
    });

    it("under RED with no repair, counts from the last fire and holds a small batch", () => {
        const c = commits(3);
        const plan = runnerPlan({
            tip: c[2].sha,
            lineage: lineageOf([red()]),
            commits: c,
            lastFire: { sha: RED_SHA, at: T0 - 2 * HOUR },
            now: T0 + 20 * MIN,
        });
        expect(plan).toMatchObject({
            kind: "hold",
            reason: expect.stringMatching(/^RED:/),
        });
    });

    it("STOPS on a second RED on the lineage", () => {
        const lineage = lineageOf([red("f".repeat(40)), amber(sha(1)), red()]);
        expect(lineage.kind).toBe("second-red");
        const plan = runnerPlan({
            tip: sha(5),
            lineage,
            commits: commits(5),
            lastFire: null,
            now: T0 + 10 * HOUR,
        });
        expect(plan.kind).toBe("stop");
    });

    it("gates an UNPROVEN base: no completed verdict in the store, or a base the tip does not descend from", () => {
        const none = runnerPlan({
            tip: sha(1),
            lineage: lineageOf([]),
            commits: null,
            lastFire: null,
            now: T0,
        });
        expect(none).toMatchObject({ kind: "fire", trigger: "unproven" });
        const forcePushed = runnerPlan({
            tip: sha(1),
            lineage: lineageOf([green()]),
            commits: null,
            lastFire: null,
            now: T0,
        });
        expect(forcePushed).toMatchObject({
            kind: "fire",
            trigger: "unproven",
        });
        // An infra-only history proves nothing either, but its re-fire waits
        // out the dedup like any other.
        expect(
            runnerPlan({
                tip: sha(1),
                lineage: lineageOf([
                    {
                        sha: sha(1),
                        status: "infra",
                        at: new Date(T0).toISOString(),
                    },
                ]),
                commits: null,
                lastFire: { sha: sha(1), at: T0 },
                now: T0 + 10 * MIN,
            }).kind
        ).toBe("hold");
    });
});

/** A `VerdictStore` over a hand-built history, newest first. */
function fakeStore(history: Verdict[] | (() => never)): VerdictStore {
    const list = () => (typeof history === "function" ? history() : history);
    return {
        backend: "github",
        read: (s) => list().find((v) => v.sha === s) ?? null,
        write: () => ({ written: true }),
        latest: () => list()[0] ?? null,
        lineage: () => lineageOf(list()),
    };
}

function ledger(n: number, over: Partial<CadenceState> = {}): CadenceState {
    return { ...EMPTY_CADENCE, landings: commits(n), ...over };
}

describe("MacBook stale-verdict fallback at the cadence seam (issue #5467)", () => {
    // 20 landings, 5 min apart from T0: the batch is due by COUNT at the
    // 20th, T0 + 95 min.
    const due = ledger(LANDINGS_PER_BATCH);
    const tip = sha(LANDINGS_PER_BATCH);
    const dueAt = T0 + 95 * MIN;
    const decide = (
        history: Verdict[] | (() => never),
        over: { state?: CadenceState; now?: number; tip?: string } = {}
    ) =>
        remoteCadenceDecision({
            state: over.state ?? due,
            tip: over.tip ?? tip,
            now: over.now ?? dueAt + MAX_PENDING_MS,
            red: false,
            readLineage: () => fakeStore(history).lineage(),
        });

    it("holds a due batch while the runner still has time to answer it", () => {
        const { verdict } = decide([green(BASE, T0 - 9 * HOUR)], {
            now: dueAt + MAX_PENDING_MS - MIN,
        });
        expect(verdict).toMatchObject({
            kind: "hold",
            reason: expect.stringContaining("health runner owns this batch"),
        });
    });

    it("runs ONE local health when no GREEN or RED came MAX_PENDING after the batch fell due", () => {
        const { verdict } = decide([green(BASE, T0 - HOUR)]);
        expect(verdict).toMatchObject({
            kind: "fire",
            trigger: "stale",
            sha: tip,
            dueAt,
        });
    });

    it("an AGE-fired batch is not stale while the runner gates it: silence counts from the batch, not the old verdict", () => {
        // Two landings; the oldest turns 8 h old at T0 + 8 h, so the newest
        // verdict is ≥ 8 h old by construction — and the runner is working.
        const ageDue = T0 + MAX_BATCH_AGE_MS;
        const { verdict } = decide([green(BASE, T0 - HOUR)], {
            state: ledger(2),
            tip: sha(2),
            now: ageDue + 30 * MIN,
        });
        expect(verdict).toMatchObject({
            kind: "hold",
            reason: expect.stringContaining("owns this batch"),
        });
    });

    it("holds once the runner answered the batch, RED included, and adopts that RED as the last fire", () => {
        const answered = red(sha(LANDINGS_PER_BATCH), dueAt + HOUR);
        const { verdict, state } = decide([answered]);
        expect(verdict.kind).toBe("hold");
        expect(state.lastFiredSha).toBe(sha(LANDINGS_PER_BATCH));
    });

    it("does not count an INFRA as an answer", () => {
        const { verdict } = decide([
            {
                sha: tip,
                status: "infra",
                at: new Date(dueAt + HOUR).toISOString(),
            },
            green(BASE, T0 - HOUR),
        ]);
        expect(verdict).toMatchObject({ kind: "fire", trigger: "stale" });
    });

    it("does not count an AMBER as an answer: a repair landing proves nothing about the batch", () => {
        const { verdict } = decide([
            { ...amber(tip), at: new Date(dueAt + HOUR).toISOString() },
            red(),
        ]);
        expect(verdict).toMatchObject({ kind: "fire", trigger: "stale" });
    });

    it("runs the fallback once per batch: a second landing after it holds", () => {
        const { verdict } = decide([green(BASE, T0 - HOUR)], {
            state: {
                ...ledger(LANDINGS_PER_BATCH + 1),
                lastFiredSha: tip,
                lastFiredAt: dueAt + MAX_PENDING_MS,
            },
            tip: sha(LANDINGS_PER_BATCH + 1),
            now: dueAt + MAX_PENDING_MS + 10 * MIN,
        });
        expect(verdict).toMatchObject({
            kind: "hold",
            reason: expect.stringContaining("already started"),
        });
    });

    it("stands down on a SECOND RED: the loop is stopped and the owner notified", () => {
        const { verdict } = decide([
            red("f".repeat(40), T0 - 7 * HOUR),
            amber(sha(1)),
            red(),
        ]);
        expect(verdict).toMatchObject({
            kind: "hold",
            reason: expect.stringContaining("SECOND RED"),
        });
    });

    it("treats an empty store as unanswered", () => {
        const { verdict } = decide([]);
        expect(verdict).toMatchObject({ kind: "fire", trigger: "stale" });
    });

    it("never calls a quiet base stale: a batch that is not due holds", () => {
        const { verdict } = decide([green(BASE, T0 - 3 * 24 * HOUR)], {
            state: ledger(2),
            tip: sha(2),
            now: T0 + HOUR,
        });
        expect(verdict.kind).toBe("hold");
    });

    it("holds when the store cannot be read", () => {
        const { verdict } = decide(() => {
            throw new Error("gh api graphql failed (exit 1)");
        });
        expect(verdict).toMatchObject({
            kind: "hold",
            reason: expect.stringContaining("unreadable"),
        });
    });

    it("adopts the runner's GREEN: the ledger prunes what it covered", () => {
        const { verdict, state } = decide([green(sha(18), T0 + 2 * HOUR)], {
            now: T0 + 3 * HOUR,
        });
        expect(state.lastGreenSha).toBe(sha(18));
        expect(state.landings.map((l) => l.sha)).toEqual([sha(19), sha(20)]);
        expect(verdict.kind).toBe("hold");
    });

    it("returns the SAME state object when there is nothing to adopt — no needless write", () => {
        const s = { ...due, lastGreenSha: BASE };
        expect(decide([green(BASE, T0 - HOUR)], { state: s }).state).toBe(s);
    });
});

describe("health runner config (issue #5467)", () => {
    it("absent means no runner: every machine's cadence gates locally", () => {
        expect(healthRunnerMode(parseHealthRunnerConfig({}), "darwin")).toBe(
            "local"
        );
        expect(healthRunnerMode(parseHealthRunnerConfig(null), "linux")).toBe(
            "local"
        );
    });

    it("set, the named platform gates and every other one falls back", () => {
        const config = parseHealthRunnerConfig({
            healthRunner: { platform: "linux" },
        });
        expect(healthRunnerMode(config, "linux")).toBe("here");
        expect(healthRunnerMode(config, "darwin")).toBe("remote");
    });
});

/** A whole tick over a fake store, a fake git and a recorded gate. */
function harness(over: {
    history: Verdict[] | (() => never);
    commits?: BaseCommit[] | null;
    tip?: string;
    state?: RunnerState;
    now?: number;
    status?: number;
}) {
    const calls = {
        runs: [] as string[],
        notes: [] as string[],
        writes: [] as RunnerState[],
        stateAtRun: null as RunnerState | null,
    };
    let state = over.state ?? EMPTY_RUNNER_STATE;
    const c =
        over.commits === undefined ? commits(LANDINGS_PER_BATCH) : over.commits;
    const deps: RunnerDeps = {
        fetchTip: () => over.tip ?? sha(LANDINGS_PER_BATCH),
        commitsSince: () => c,
        store: () => fakeStore(over.history),
        readLast: () => null,
        readState: () => state,
        writeState: (s) => {
            state = s;
            calls.writes.push(s);
        },
        runHealth: (t) => {
            calls.stateAtRun = state;
            calls.runs.push(t);
            return over.status ?? 0;
        },
        notify: (m) => calls.notes.push(m),
        now: () => over.now ?? T0 + 2 * HOUR,
        log: () => {},
    };
    return { deps, calls };
}

describe("health runner — one tick (issue #5467)", () => {
    it("on a fire, stamps the dedup BEFORE the run, gates the tip, and reports the gate's status", () => {
        const { deps, calls } = harness({ history: [green()], status: 1 });
        const r = runnerTick(deps);
        expect(calls.runs).toEqual([sha(LANDINGS_PER_BATCH)]);
        expect(calls.stateAtRun?.lastFire?.sha).toBe(sha(LANDINGS_PER_BATCH));
        expect(r.code).toBe(1);
    });

    it("--dry-run decides and touches nothing", () => {
        const { deps, calls } = harness({ history: [green()] });
        const r = runnerTick(deps, { dryRun: true });
        expect(r.plan?.kind).toBe("fire");
        expect(calls.runs).toEqual([]);
        expect(calls.writes).toEqual([]);
    });

    it("a second RED stops the runner and notifies ONCE", () => {
        const history = [red("f".repeat(40)), amber(sha(1)), red()];
        const { deps, calls } = harness({ history });
        runnerTick(deps);
        runnerTick(deps);
        expect(calls.runs).toEqual([]);
        expect(calls.notes).toHaveLength(1);
        expect(calls.notes[0]).toContain("second RED");
    });

    it("a base that cannot be fetched holds: nothing runs, no crash", () => {
        const { deps, calls } = harness({ history: [green()] });
        deps.fetchTip = () => {
            throw new Error("git fetch origin staging failed");
        };
        expect(runnerTick(deps)).toEqual({ plan: null, code: 0 });
        expect(calls.runs).toEqual([]);
    });

    it("an unreadable store holds: nothing runs", () => {
        const { deps, calls } = harness({
            history: () => {
                throw new Error("gh api graphql failed (exit 1)");
            },
        });
        expect(runnerTick(deps)).toEqual({ plan: null, code: 0 });
        expect(calls.runs).toEqual([]);
    });
});

describe("health runner parsing", () => {
    it("reads `git log --format='%H %ct'` lines, skipping noise", () => {
        expect(
            parseCommitLines(
                `${sha(1)} 1760000000\n\n${sha(2)} 1760000060\nnoise`
            )
        ).toEqual([
            { sha: sha(1), at: 1_760_000_000_000 },
            { sha: sha(2), at: 1_760_000_060_000 },
        ]);
    });

    it("reads a torn state file as empty", () => {
        expect(parseRunnerState("{nope")).toEqual(EMPTY_RUNNER_STATE);
        expect(
            parseRunnerState(
                JSON.stringify({
                    lastFire: { sha: BASE, at: T0 },
                    notifiedSecondRed: RED_SHA,
                })
            )
        ).toEqual({
            lastFire: { sha: BASE, at: T0 },
            notifiedSecondRed: RED_SHA,
        });
    });
});
