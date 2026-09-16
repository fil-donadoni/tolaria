/**
 * Viewport parallelism — speed sized to the machine (issue #3653, PRD #3643;
 * ADR 0132 § Considered options).
 *
 * WHY. The lane's wall time is five viewports deep and the five are
 * independent: each opens its own browser context, walks the same surfaces and
 * reports its own cells. Walking them one at a time is right on a machine that
 * is already flat out — five Chromium contexts on a busy box turn a UI
 * question into an INFRA verdict (issue #3644) — and pure waste on an idle one.
 * So the count is a FUNCTION OF THE MACHINE, read once at the start of the run.
 *
 * WHAT MUST NOT CHANGE WITH IT. `land` re-derives the verdict block from the
 * PR's diff and refuses a mismatch, so a receipt that depended on how many
 * contexts happened to run at once would be a receipt nobody could reproduce.
 * `collectRun` is the answer: every viewport reports a `ViewportResult`, the
 * results are re-ordered into the fixed Viewport Matrix order whatever order
 * they FINISHED in, and only then do cells, walks and diagnostics get built. An
 * N=1 run and an N=5 run of one tree print the same verdict block, byte for
 * byte — `ui-gate-parallelism.test.ts` proves it on shuffled results.
 *
 * WHAT DOES CHANGE. Wall time, the load line, and the ORDER work happened in —
 * all of them diagnostic, none of them read by `land`.
 */
import type { InfraCell, Measurement, SurfaceWalk } from "./receipt.ts";
import { VIEWPORTS } from "./viewports.ts";

/** Never more contexts than there are viewports to put in them. */
export const MAX_PARALLELISM = VIEWPORTS.length;

/**
 * Cores held back from the count: the lane's own Vite, this process, and the
 * local Convex backend every context is talking to. Without it a quiet
 * 8-core machine would promise a context to every core and then contend with
 * the server answering them.
 */
export const RESERVED_CORES = 1;

/**
 * How many viewports to walk at once, from the 1-minute load average and the
 * core count — one context per free core, minus the lane's own reserve,
 * clamped to 1..5.
 *
 * Pure, and total: a machine that reports nonsense (a load that is NaN, a core
 * count of zero) gets the sequential lane, which is the answer that is never
 * wrong, only slow.
 */
export function viewportParallelism(load: number, ncpu: number): number {
    if (!Number.isFinite(load) || !Number.isFinite(ncpu)) return 1;
    const cores = Math.max(1, Math.floor(ncpu));
    const busy = Math.max(0, load);
    const free = Math.floor(cores - busy - RESERVED_CORES);
    return Math.max(1, Math.min(MAX_PARALLELISM, free));
}

/** `--parallel=N`'s value. Throws with the operator's own number in the
 *  message — a typo that silently fell back to the sized count would make the
 *  flag's whole purpose (reproducing a receipt at a chosen N) unreliable. */
export function parseParallelOverride(raw: string): number {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PARALLELISM) {
        throw new Error(
            `--parallel=${raw} is not a viewport count: it takes an integer 1..${MAX_PARALLELISM}`
        );
    }
    return n;
}

/**
 * Run `worker` over `items`, at most `limit` in flight, and return the results
 * in ITEM order however they finished.
 *
 * `lane` is the worker's own index, and it is NOT the item's: a lane owns a
 * resource nothing else may touch while it is working — here, the lane account
 * whose one-game-per-account gate is the reason the contexts can run at all.
 * Keying that off the item index instead would hand account 0 to item 3 while
 * item 0 was still playing its game.
 *
 * A worker that throws takes the pool down with it, deliberately — the lane
 * classifies its own failures per cell, so an exception reaching here is a bug
 * in the lane, not an outcome to average away.
 */
export async function runPool<T, R>(
    items: readonly T[],
    limit: number,
    worker: (item: T, index: number, lane: number) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const lanes = Math.max(1, Math.min(limit, items.length));
    await Promise.all(
        Array.from({ length: lanes }, async (_unused, lane) => {
            for (let i = next++; i < items.length; i = next++) {
                results[i] = await worker(items[i], i, lane);
            }
        })
    );
    return results;
}

/** What one viewport's walk reports back. Everything the run prints or
 *  evaluates is derived from these, so a viewport owns its findings rather
 *  than writing into shared maps as it goes. */
export interface ViewportResult {
    viewport: string;
    /** The cell lines this viewport logged, in the order it walked them. */
    lines: readonly string[];
    measured: readonly {
        surface: string;
        readings: Measurement["readings"];
        /** This cell's Named Assertions (ADR 0132 §3, issue #3649). Folded
         *  into the `Measurement` below, so an N=1 and an N=5 run report the
         *  same assertion lines in the same order. */
        asserts?: Measurement["asserts"];
    }[];
    /** Surfaces this viewport could not reach, with the reason. */
    unreachable: readonly { surface: string; reason: string }[];
    infra: readonly { surface: string; cell: InfraCell }[];
    consoleErrors: readonly string[];
    bandWalks: readonly { where: string; excluded: number }[];
}

export interface CollectedRun {
    /** Every cell line, grouped by viewport in Viewport Matrix order. */
    lines: string[];
    walks: SurfaceWalk[];
    consoleErrors: string[];
    bandWalks: { where: string; excluded: number }[];
}

/**
 * Fold the viewports' results into the run's, in the fixed order — the single
 * place parallelism is made invisible.
 *
 * A surface UNREACHABLE at ANY viewport is unreachable for the run, as it was
 * when one shared map short-circuited the later viewports; the reason kept is
 * the FIRST in viewport order, never the first to arrive. Its measurements from
 * the other viewports are dropped, exactly as `evaluateRun` would ignore them.
 */
export function collectRun(input: {
    knownSurfaceIds: readonly string[];
    viewportIds: readonly string[];
    results: readonly ViewportResult[];
}): CollectedRun {
    const order = new Map(input.viewportIds.map((id, i) => [id, i]));
    const ordered = [...input.results].sort(
        (a, b) =>
            (order.get(a.viewport) ?? Number.MAX_SAFE_INTEGER) -
            (order.get(b.viewport) ?? Number.MAX_SAFE_INTEGER)
    );

    const unreachable = new Map<string, string>();
    const measured = new Map<string, Measurement[]>();
    const infra = new Map<string, InfraCell[]>();
    const lines: string[] = [];
    const consoleErrors: string[] = [];
    const bandWalks: { where: string; excluded: number }[] = [];

    for (const result of ordered) {
        lines.push(...result.lines);
        consoleErrors.push(...result.consoleErrors);
        bandWalks.push(...result.bandWalks);
        for (const u of result.unreachable) {
            if (!unreachable.has(u.surface))
                unreachable.set(u.surface, u.reason);
        }
        for (const m of result.measured) {
            const list = measured.get(m.surface) ?? [];
            list.push({
                viewport: result.viewport,
                readings: m.readings,
                asserts: m.asserts,
            });
            measured.set(m.surface, list);
        }
        for (const cell of result.infra) {
            const list = infra.get(cell.surface) ?? [];
            list.push(cell.cell);
            infra.set(cell.surface, list);
        }
    }

    const walks: SurfaceWalk[] = [];
    for (const id of input.knownSurfaceIds) {
        const reason = unreachable.get(id);
        if (reason) {
            walks.push({ surface: id, status: "unreachable", reason });
        } else if (measured.has(id) || infra.has(id)) {
            walks.push({
                surface: id,
                status: "measured",
                measurements: measured.get(id) ?? [],
                infra: infra.get(id),
            });
        }
    }

    return { lines, walks, consoleErrors, bandWalks };
}
