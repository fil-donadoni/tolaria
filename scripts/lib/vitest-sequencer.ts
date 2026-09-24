/**
 * The file order every vitest invocation of `vitest.config.ts` runs in
 * (issue #4483, PRD #4480 T2).
 *
 * WHY. Vitest's `BaseSequencer` orders projects by NAME, and one invocation
 * feeds every project's files into a single worker pool in that order. So the
 * longest project could start last: measured 2026-09-24, `node-tooling` ran
 * after `node-engine` and `bot-node` after `bot-dom` — `loop-drain` (59 s)
 * started at +55 s and ended exactly at the 114 s node wall, `bot-node`
 * started at +36 s. Longest-processing-time-first is the textbook fix for a
 * makespan bounded by its tail.
 *
 * THE RULE, three keys:
 *
 *   1. `sequence.groupOrder` first — vitest runs each group to completion
 *      before the next, so an order that crossed groups would be a lie.
 *   2. Projects by the SUM of their cached file durations, descending (ties by
 *      name). Each project's files stay CONTIGUOUS: with `maxWorkers > 1`
 *      every file is its own pool task, and a finishing `isolate: false`
 *      worker is kept only when the task at the HEAD of the queue belongs to
 *      the same project (`Pool.schedule` / `isEqualRunner`), so interleaving
 *      two projects would make every
 *      `isolate: false` worker restart and re-import the catalogue — the 6.5 s
 *      no-test gap measured at the engine→tooling switch, paid per switch.
 *   3. Within a project, files with NO cached duration first (a new file's
 *      cost is unknown — the same bet `BaseSequencer` makes), then longest
 *      first; ties by path, so the order is a pure function of the cache.
 *
 * NO order derived from the diff (ADR 0104): the only input is vitest's own
 * results cache, which says how long a file took, never whether it changed.
 * Every project still runs whole — this module reorders, it never filters,
 * and `orderSpecs` returns a permutation of its input.
 *
 * The cache lives in the gitignored `node_modules/.vite/vitest/`, so a fresh
 * gate worktree has none; `scripts/lib/worktree-seed.ts` seeds it from the
 * primary. With no cache at all every duration is unknown and the order
 * degrades to groupOrder → project name → path.
 */
import { relative } from "node:path";
import { BaseSequencer } from "vitest/node";
import type { TestSpecification } from "vitest/node";

/** The three facts the ordering rule reads off one test file. */
export interface SpecKey {
    /** `sequence.groupOrder` of the file's project. */
    groupOrder: number;
    /** The vitest project name. */
    project: string;
    /** The file's path relative to the vitest root — the cache key's tail. */
    file: string;
}

/** Cached wall duration (ms) of `file` in `project`, or `undefined` if unknown. */
export type DurationLookup = (
    project: string,
    file: string
) => number | undefined;

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Orders `specs` by the rule above. Pure: the same specs and the same cache
 * give the same order, and the result is a permutation of the input.
 */
export function orderSpecs<T>(
    specs: readonly T[],
    keyOf: (spec: T) => SpecKey,
    durationOf: DurationLookup
): T[] {
    const rows = specs.map((spec) => {
        const key = keyOf(spec);
        return { spec, key, duration: durationOf(key.project, key.file) };
    });

    const projectTotal = new Map<string, number>();
    for (const { key, duration } of rows) {
        projectTotal.set(
            key.project,
            (projectTotal.get(key.project) ?? 0) + (duration ?? 0)
        );
    }

    return rows
        .sort((a, b) => {
            if (a.key.groupOrder !== b.key.groupOrder) {
                return a.key.groupOrder - b.key.groupOrder;
            }
            if (a.key.project !== b.key.project) {
                const total =
                    projectTotal.get(b.key.project)! -
                    projectTotal.get(a.key.project)!;
                return total !== 0
                    ? total
                    : byString(a.key.project, b.key.project);
            }
            if ((a.duration === undefined) !== (b.duration === undefined)) {
                return a.duration === undefined ? -1 : 1;
            }
            const longer = (b.duration ?? 0) - (a.duration ?? 0);
            return longer !== 0 ? longer : byString(a.key.file, b.key.file);
        })
        .map((row) => row.spec);
}

/**
 * The sequencer `vitest.config.ts` registers as `sequence.sequencer`. It keeps
 * `BaseSequencer.shard` and replaces only `sort`, reading durations from the
 * same results cache (and the same `<project>:<relative path>` key) vitest
 * writes after every run.
 */
export class LongestFirstSequencer extends BaseSequencer {
    override async sort(
        files: TestSpecification[]
    ): Promise<TestSpecification[]> {
        const root = this.ctx.config.root;
        const cache = this.ctx.cache;
        return orderSpecs(
            files,
            (spec) => ({
                groupOrder: spec.project.config.sequence.groupOrder,
                project: spec.project.name,
                file: relative(root, spec.moduleId),
            }),
            (project, file) =>
                cache.getFileTestResults(`${project}:${file}`)?.duration
        );
    }
}
