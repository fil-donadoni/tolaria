/**
 * The seconds-cost subset of a lane plan that `land:ready` runs BEFORE it
 * queues a PR (issue #5554).
 *
 * WHY. On 2026-10-12 the land-runner made 33 attempts and 19 failed; ~13 of
 * those carried an error the PR itself held and a step costing seconds would
 * have shown (`tsc[all]`, `cr:lint`, a test file the docs-lane census did not
 * classify, the PR's own script tests). Each cost a 3–4 min land cycle under
 * the gate mutex, a `land-failed` label and a repair session that reloads the
 * context. The authoring session fixes the same error inline for free.
 *
 * ONE AUTHORITY. The steps are `check:lane`'s own plan (`classifyLane`),
 * FILTERED — never a second hand-maintained list. A step added to the lane
 * appears here unless `EXCLUDED_FROM_PRE_QUEUE` names it; the exclusion table
 * is the only list in this file, and it lists what is NOT seconds-cost.
 * `HEALTH_ONLY_GUARDS` need no row: the lane never plans them.
 *
 * Pure: no I/O. `check-lane.ts` / `land-ready.ts` do the git and the shell.
 */
import {
    CHEAP_GUARDS,
    fullLaneSecondsSteps,
    type LanePlan,
    type PlannedCheck,
} from "../check-lane";

/** Steps the lane plans that are NOT seconds-cost, by id, with the reason. */
export const EXCLUDED_FROM_PRE_QUEUE: Readonly<Record<string, string>> = {
    "check:pr:app":
        "the `full` lane's verbatim delegation runs the whole check:all:inner — minutes, the runner's to pay",
    "vitest(bot)":
        "the `full` lane's bot half (issue #6149) — up to the whole bot fast lane, ~122 s at land; the runner's to pay",
};

/**
 * A vitest command that names a project and no file filter runs the whole
 * project (the `node-tooling` admission in check-lane.ts) — not seconds.
 */
const WHOLE_PROJECT_VITEST = /^bunx vitest run( --project \S+)+\s*$/;

/**
 * The pure/offline tier (issue #6620): `bun run <script>` steps that read the
 * tree and run no vitest — seconds each. They run FIRST and ALL of them (a
 * session fixes five findings once, not in five rounds); a red anywhere in the
 * tier means the tests behind it never start. Derived from `CHEAP_GUARDS`
 * (the ones that are plain scripts) plus the lane's other offline checks —
 * never a second list of guards.
 */
const CHEAP_TIER_COMMANDS: ReadonlySet<string> = new Set([
    ...CHEAP_GUARDS.filter((g) => g.command === undefined).map(
        (g) => `bun run ${g.id}`
    ),
    "bun run cr:lint",
    "bun run check:index",
    "bun run check:stubs",
    "bun run check:oracle",
    "bun run check:docs",
]);

/** True when the step is in the cheap, run-them-all tier. */
export function isCheapStep(check: PlannedCheck): boolean {
    return CHEAP_TIER_COMMANDS.has(check.command);
}

/** Tests that run in a suite the lane never gates (`HEALTH_ONLY_GUARDS`). */
const HEALTH_ONLY_TEST = /\.(bot|perf)\.test\.tsx?$/;
const TEST_FILE = /\.test\.tsx?$/;

/**
 * Structural guards that red on a NEW file the diff adds. An added path that
 * `admits` runs `test`. The observed case: a new `scripts/__tests__/*.test.ts`
 * not classified in `docs-lane.ts` (PR #5528, PR #5545). The import-graph walk
 * cannot select these — they read the tree through `fs`. A new `data/` file
 * not classified in `generated-artifacts.ts` reds the lane the same way (PR
 * #6562 failure 1, issue #6654).
 */
export const NEW_FILE_GUARDS: readonly {
    admits: RegExp;
    test: string;
}[] = [
    {
        admits: /^scripts\/__tests__\/[^/]+\.test\.ts$/,
        test: "scripts/__tests__/docs-lane.test.ts",
    },
    {
        admits: HEALTH_ONLY_TEST,
        test: "scripts/__tests__/bot-suite-boundary.test.ts",
    },
    {
        admits: /^src\/.*\.test\.tsx?$/,
        test: "scripts/__tests__/src-test-env-split.test.ts",
    },
    {
        admits: /^data\//,
        test: "scripts/__tests__/generated-artifact-merge.test.ts",
    },
];

function shellQuote(path: string): string {
    return `'${path.replace(/'/g, `'\\''`)}'`;
}

export interface PreQueueSkip {
    id: string;
    reason: string;
}

export interface PreQueuePlan {
    run: PlannedCheck[];
    skip: PreQueueSkip[];
}

/**
 * The time budget (seconds) of the scoped test run before queuing (issue
 * #8063). Pre-queue is for errors a session fixes inline, reported in
 * seconds (issue #5554); a run whose estimated cost passes this is skipped
 * with a line naming the cost, and the queue's lane pays it once on the
 * rebased tip (ADR 0136).
 */
export const PRE_QUEUE_BUDGET_S = 120;

/**
 * Estimated seconds one reached test file costs on the light gate (vitest
 * <= 2 workers, load around 14). Anchored on issue #8063's observation: a
 * diff under the old 400-file bound ran 7426 tests and one `land:ready`
 * attempt took ~35 min, i.e. seconds per file, not tenths. A file COUNT was
 * never a cost; this constant turns it into one, so the bound is a time.
 */
export const RELATED_FILE_COST_S = 1.5;

/** The lane's scoped node/dom run, one id or one per chunk (`pushRelated`). */
const RELATED_ID = /^vitest\(related\)( \d+\/\d+)?$/;

/** Quoted filters in a planned vitest command. */
function filterCount(command: string): number {
    return command.match(/'(?:[^']|'\\'')*'/g)?.length ?? 0;
}

/** Estimated seconds of the plan's whole scoped reach (all chunks). */
export function relatedCostS(relatedFiles: number): number {
    return relatedFiles * RELATED_FILE_COST_S;
}

/**
 * Why a planned check is not seconds-cost, or null when it is. `relatedFiles`
 * is the plan's whole scoped reach, summed over its `vitest(related)` runs.
 */
export function notSecondsCost(
    check: PlannedCheck,
    relatedFiles = 0
): string | null {
    const named = EXCLUDED_FROM_PRE_QUEUE[check.id];
    if (named !== undefined) return named;
    if (WHOLE_PROJECT_VITEST.test(check.command)) {
        return "a whole vitest project, not scoped to the diff — the runner's to pay";
    }
    const cost = relatedCostS(relatedFiles);
    if (RELATED_ID.test(check.id) && cost > PRE_QUEUE_BUDGET_S) {
        return `the diff reaches ${relatedFiles} test files, ~${Math.round(cost)} s estimated (> ${PRE_QUEUE_BUDGET_S} s budget) — the runner's to pay`;
    }
    return null;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * True when a failed vitest run's output holds failures and EVERY one is a
 * timeout (issue #8063): a `Test timed out` under load says nothing the
 * queue's own lane will not re-judge. One assertion beside them, an
 * unhandled error, or no readable failure at all → false (still a refusal).
 */
export function isTimeoutOnlyRed(output: string): boolean {
    const text = output.replace(ANSI, "");
    if (/Unhandled (Errors?|Rejections?)/i.test(text)) return false;
    const blocks = text.split(/^\s*FAIL\s+/m).slice(1);
    if (blocks.length === 0) return false;
    return blocks.every((b) =>
        /^\s*(?:\w*Error: )?(?:Test|Hook) timed out in \d+ms/m.test(
            b.split("\n").slice(1).join("\n")
        )
    );
}

/**
 * The pre-queue step list for one diff.
 *
 * @param plan  the lane plan `classifyLane` built for the diff
 * @param added paths the diff ADDS (not modifies)
 * @param present changed paths that still exist at HEAD
 */
export function preQueueSteps(
    plan: LanePlan,
    added: readonly string[],
    present: readonly string[]
): PreQueuePlan {
    const run: PlannedCheck[] = [];
    const skip: PreQueueSkip[] = [];
    if (plan.lane === "full") run.push(...fullLaneSecondsSteps([...present]));
    const relatedFiles = plan.run
        .filter((c) => RELATED_ID.test(c.id))
        .reduce((n, c) => n + filterCount(c.command), 0);
    for (const check of plan.run) {
        const why = notSecondsCost(check, relatedFiles);
        if (why === null) run.push(check);
        else skip.push({ id: check.id, reason: why });
    }

    // The PR's own tests, wherever the lane put them: a docs-lane or cards
    // diff plans none, and a scoped run only names what the walk reached.
    const planned = run
        .filter((c) => c.command.includes("vitest run"))
        .map((c) => c.command)
        .join("\n");
    const touched = present.filter(
        (p) =>
            TEST_FILE.test(p) &&
            !HEALTH_ONLY_TEST.test(p) &&
            !planned.includes(shellQuote(p)) &&
            // `node[cards]` / `node[docs]` run by directory or by list.
            !planned.includes(` ${p}`)
    );
    if (touched.length > 0) {
        run.push({
            id: "vitest(touched)",
            command: `bunx vitest run ${touched.map(shellQuote).join(" ")}`,
        });
    }

    const guards = new Set<string>();
    for (const path of added) {
        for (const g of NEW_FILE_GUARDS) {
            if (g.admits.test(path)) guards.add(g.test);
        }
    }
    const fresh = [...guards].filter((t) => !planned.includes(t));
    if (fresh.length > 0) {
        run.push({
            id: "vitest(new-file guards)",
            command: `bunx vitest run ${fresh.join(" ")}`,
        });
    }
    // Cheap tier first (stable): a red there is reported in seconds.
    return {
        run: [
            ...run.filter(isCheapStep),
            ...run.filter((c) => !isCheapStep(c)),
        ],
        skip,
    };
}
