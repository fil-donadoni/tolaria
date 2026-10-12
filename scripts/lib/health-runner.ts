/**
 * The health runner's tick (issue #5467, ADR 0154 §9), over injected
 * dependencies: `scripts/health-runner.ts` is the I/O, this is the sequence
 * the tests drive with a fake store — decide (`runnerPlan`), then stop and
 * notify, hold, or stamp and run.
 *
 * Imports the pure cadence module and the verdict store's lineage reader
 * only, never the CLIs (`health-cadence.ts` pulls `bun:sqlite`).
 */
import {
    healthRunInFlight,
    runnerBase,
    runnerPlan,
    type BaseCommit,
    type HealthRecord,
    type RunnerFire,
    type RunnerPlan,
} from "./health-cadence";
import { readVerdictLineage, type VerdictStore } from "./health-verdict-store";

/** The runner's own state, beside `last.json` on the runner's machine. */
export const RUNNER_FILE = "runner.json";

export interface RunnerState {
    lastFire: RunnerFire | null;
    /** The SECOND RED sha already notified — one notification per red. */
    notifiedSecondRed: string | null;
}

export const EMPTY_RUNNER_STATE: RunnerState = {
    lastFire: null,
    notifiedSecondRed: null,
};

/** Fail-soft like the cadence ledger: a torn file reads as empty, which at
 *  worst costs one extra fire. */
export function parseRunnerState(raw: string | null): RunnerState {
    if (raw === null) return EMPTY_RUNNER_STATE;
    try {
        const doc = JSON.parse(raw) as Record<string, unknown>;
        const f = doc.lastFire as Record<string, unknown> | null | undefined;
        return {
            lastFire:
                f &&
                typeof f.sha === "string" &&
                typeof f.at === "number" &&
                Number.isFinite(f.at)
                    ? { sha: f.sha, at: f.at }
                    : null,
            notifiedSecondRed:
                typeof doc.notifiedSecondRed === "string"
                    ? doc.notifiedSecondRed
                    : null,
        };
    } catch {
        return EMPTY_RUNNER_STATE;
    }
}

/** Everything a tick touches outside its decision — injected, so the tests
 *  drive a whole tick with a fake store and no git, no gate. */
export interface RunnerDeps {
    fetchTip(): string;
    /** First-parent commits in `(base..tip]`, oldest first; null when `base`
     *  is not an ancestor of `tip` or git cannot say. */
    commitsSince(base: string, tip: string): BaseCommit[] | null;
    store(): VerdictStore;
    readLast(): HealthRecord | null;
    readState(): RunnerState;
    writeState(state: RunnerState): void;
    /** One health run on `tip`; its exit status. */
    runHealth(tip: string, firedAt: number): number | null;
    notify(message: string): void;
    now(): number;
    log(line: string): void;
}

export interface TickResult {
    plan: RunnerPlan | null;
    code: number;
}

export function runnerTick(
    deps: RunnerDeps,
    opts: { dryRun?: boolean } = {}
): TickResult {
    const tip = deps.fetchTip();
    const lineage = readVerdictLineage(deps.store);
    if (lineage.error !== undefined) {
        deps.log(
            `health-runner: holding — the verdict store is unreadable: ${lineage.error}`
        );
        return { plan: null, code: 0 };
    }
    const base = runnerBase(lineage);
    const now = deps.now();
    const state = deps.readState();
    const plan = runnerPlan({
        tip,
        lineage,
        commits: base === null ? null : deps.commitsSince(base, tip),
        lastFire: state.lastFire,
        pending: healthRunInFlight(deps.readLast(), now),
        now,
    });
    const what =
        plan.kind === "fire"
            ? `firing on ${plan.trigger} — ${plan.reason}; gating ${tip.slice(0, 8)}`
            : `${plan.kind === "stop" ? "stopped" : "holding"} — ${plan.reason}`;
    deps.log(`health-runner: ${opts.dryRun ? "[dry-run] " : ""}${what}`);
    if (opts.dryRun) return { plan, code: 0 };

    if (plan.kind === "stop") {
        const red = lineage.verdict?.sha ?? "unknown";
        if (state.notifiedSecondRed !== red) {
            deps.notify(
                `Tolaria: second RED on the base (${red.slice(0, 8)}${lineage.verdict?.step ? `, ${lineage.verdict.step}` : ""}) — health runner stopped`
            );
            deps.writeState({ ...state, notifiedSecondRed: red });
        }
        return { plan, code: 0 };
    }
    if (plan.kind === "hold") return { plan, code: 0 };

    // The dedup stamp goes in BEFORE the run: a tick the timer starts while
    // this one still gates holds on it, whatever `last.json` says yet.
    deps.writeState({ ...state, lastFire: { sha: tip, at: now } });
    const status = deps.runHealth(tip, now);
    deps.log(
        `health-runner: health on ${tip.slice(0, 8)} exited ${status ?? "on a signal"} — the verdict is in the store`
    );
    return { plan, code: status === 0 ? 0 : 1 };
}

/** `git log` lines `<sha> <committer epoch s>`, parsed. */
export function parseCommitLines(out: string): BaseCommit[] {
    const commits: BaseCommit[] = [];
    for (const line of out.split("\n")) {
        const m = /^([0-9a-f]{40}) (\d+)$/.exec(line.trim());
        if (m) commits.push({ sha: m[1], at: Number(m[2]) * 1000 });
    }
    return commits;
}
