/**
 * The vitest reporter behind health's test timeout headroom (issue #5484,
 * `lib/test-headroom.ts`). It sits BESIDE the default reporter, and only when
 * `TOLARIA_TEST_DURATIONS_DIR` names a directory — which only
 * `health-main.ts` sets — so no other run sees it.
 *
 * At the end of each vitest invocation it writes one `DurationFile`: every
 * test that ran, its project, its duration and the timeout it ran under (its
 * own `it(…, ms)` override, else its project's `testTimeout`), kept when at or
 * above `RECORD_FLOOR` of that budget. It never fails the run: a write error
 * is reported on stderr and dropped.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { isAgent } from "std-env";
import type { Reporter, TestModule } from "vitest/node";
import {
    DURATIONS_ENV,
    headroomRatio,
    RECORD_FLOOR,
    type DurationFile,
    type TestDuration,
} from "./test-headroom";

/** The slice of vitest's `TestModule` the collection reads — structural, so
 *  the seam is testable with plain objects. */
export interface DurationModule {
    moduleId: string;
    project: { name: string; config: { testTimeout: number } };
    children: {
        allTests(): Iterable<{
            fullName: string;
            options: { timeout?: number | undefined };
            result(): { state: string };
            diagnostic(): { duration: number } | undefined;
        }>;
    };
}

/** The records one invocation's modules yield, at or above `floor`. */
export function collectDurations(
    modules: readonly DurationModule[],
    root: string,
    floor = RECORD_FLOOR
): TestDuration[] {
    const out: TestDuration[] = [];
    for (const m of modules) {
        const file = relative(root, m.moduleId).split("\\").join("/");
        for (const t of m.children.allTests()) {
            const d = t.diagnostic();
            if (d === undefined) continue; // skipped, or never ran
            const rec: TestDuration = {
                test: `${file} > ${t.fullName}`,
                project: m.project.name,
                durationMs: Math.round(d.duration),
                timeoutMs: t.options.timeout ?? m.project.config.testTimeout,
                state: t.result().state,
            };
            if (headroomRatio(rec) >= floor) out.push(rec);
        }
    }
    return out;
}

export class DurationReporter implements Reporter {
    private readonly dir: string;
    private readonly root: string;

    constructor(dir: string, root: string = process.cwd()) {
        this.dir = dir;
        this.root = root;
    }

    onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
        try {
            const file: DurationFile = {
                version: 1,
                records: collectDurations(
                    testModules as unknown as readonly DurationModule[],
                    this.root
                ),
            };
            mkdirSync(this.dir, { recursive: true });
            writeFileSync(
                join(this.dir, `${process.pid}-${Date.now()}.json`),
                JSON.stringify(file)
            );
        } catch (err) {
            console.error(
                `vitest-duration-reporter: not written (advisory) — ${String(err)}`
            );
        }
    }
}

/** The `test.reporters` a vitest config spreads in: vitest's own default
 *  reporter plus this one when `env` names a durations directory, nothing
 *  otherwise. An explicit list replaces vitest's pick, so the pick is made
 *  the way vitest makes it (`agent` under an agent, `default` elsewhere,
 *  std-env's `isAgent`): health's output — what `retryDecision` and
 *  `timeoutOnlyFailure` read — keeps its shape. */
export function durationReporterOption(env: NodeJS.ProcessEnv): {
    reporters?: (string | Reporter)[];
} {
    const dir = env[DURATIONS_ENV];
    return dir
        ? {
              reporters: [
                  isAgent ? "agent" : "default",
                  new DurationReporter(dir),
              ],
          }
        : {};
}
