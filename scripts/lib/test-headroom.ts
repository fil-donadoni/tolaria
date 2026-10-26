/**
 * Test timeout headroom (issue #5484): how close each test runs to its own
 * `testTimeout`, MEASURED by the health gate and NEVER asserted by a test.
 *
 * Health went RED at 65ab8337 (issue #5477) on two bot tests that hit the 60s
 * `bot-node` budget with no failed assertion: idle they used 40–50% of it,
 * the contended gate ran them ~2.7× slower, and nothing had shown they were
 * close. On the Huawei (~0.35× the M1 Pro) a test with comfortable headroom
 * here can sit at its timeout there.
 *
 * The pipeline:
 *
 *   1. `lib/vitest-duration-reporter.ts` — a vitest reporter, added beside the
 *      default one only when `DURATIONS_ENV` names a directory, writes one
 *      `DurationFile` per vitest invocation: every test at or above
 *      `RECORD_FLOOR` of its budget.
 *   2. `health-main.ts` sets that directory for its run
 *      (`.claude/telemetry/health/durations/<sha12>/`), writes `run.json`
 *      once the offline steps end, and appends `headroomLine` to the per-sha
 *      log — ADVISORY: the verdict is read from step exits, never from it.
 *   3. `telemetry-ingest.ts` loads each finished run into `test_headroom`;
 *      `telemetry:latency --headroom [N]` renders `headroomView`.
 *
 * Node builtins only: `health-main.ts`, the vitest config and the reporter
 * all import it.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The directory a health run's vitest invocations write their files to. */
export const DURATIONS_ENV = "TOLARIA_TEST_DURATIONS_DIR";

/** A test above this share of its `testTimeout` is reported. */
export const HEADROOM_THRESHOLD = 0.5;

/** A test below this share is not recorded at all: the trend toward the
 *  threshold stays visible, and a run writes tens of rows, not thousands. */
export const RECORD_FLOOR = 0.1;

/** The marker `health-main.ts` writes once the offline steps ended — the
 *  ingest reads a run only when it is there. */
export const RUN_FILE = "run.json";

export interface TestDuration {
    /** `<file relative to the root> > <describe> > <test>`. */
    test: string;
    project: string;
    durationMs: number;
    timeoutMs: number;
    /** vitest's result state: `passed`, `failed`, … */
    state: string;
}

/**
 * One bot test FILE's wall in one vitest invocation (issue #6943): what
 * `lib/bot-test-costs.ts` derives the lane's per-file cost table from. Every
 * bot file is recorded, whatever its share of a budget — the cheap ones are
 * the ones the lane admits.
 */
export interface FileWall {
    /** The file, relative to the root, posix. */
    file: string;
    project: string;
    /** Environment setup + prepare + collect + setup + tests and hooks. */
    wallMs: number;
    /** vitest's module state: `passed`, `failed`, … */
    state: string;
}

/** The projects whose files `FileWall` rows are written for. */
export const FILE_WALL_PROJECT = /^bot-/;

export interface DurationFile {
    version: 1;
    records: TestDuration[];
    /** Absent in a file written before issue #6943. */
    files?: FileWall[];
}

export interface HeadroomRun {
    sha12: string;
    machine: string;
    /** Epoch seconds the offline steps ended. */
    ts: number;
    records: TestDuration[];
}

/** Share of the budget a test used; 0 when the budget is not a number. */
export function headroomRatio(d: {
    durationMs: number;
    timeoutMs: number;
}): number {
    if (!(d.timeoutMs > 0) || !Number.isFinite(d.durationMs)) return 0;
    return d.durationMs / d.timeoutMs;
}

function isRecord(r: unknown): r is TestDuration {
    if (typeof r !== "object" || r === null) return false;
    const o = r as Record<string, unknown>;
    return (
        typeof o.test === "string" &&
        typeof o.project === "string" &&
        typeof o.durationMs === "number" &&
        Number.isFinite(o.durationMs) &&
        typeof o.timeoutMs === "number" &&
        o.timeoutMs > 0 &&
        typeof o.state === "string"
    );
}

/** The records of one reporter file; a malformed file or row is dropped,
 *  never thrown — headroom is advisory. */
export function parseDurationFile(text: string): TestDuration[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return [];
    }
    const records = (parsed as Partial<DurationFile> | null)?.records;
    return Array.isArray(records) ? records.filter(isRecord) : [];
}

function isFileWall(r: unknown): r is FileWall {
    if (typeof r !== "object" || r === null) return false;
    const o = r as Record<string, unknown>;
    return (
        typeof o.file === "string" &&
        typeof o.project === "string" &&
        typeof o.wallMs === "number" &&
        Number.isFinite(o.wallMs) &&
        o.wallMs >= 0 &&
        typeof o.state === "string"
    );
}

/** The file walls of one reporter file (issue #6943); malformed → dropped. */
export function parseFileWalls(text: string): FileWall[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return [];
    }
    const files = (parsed as Partial<DurationFile> | null)?.files;
    return Array.isArray(files) ? files.filter(isFileWall) : [];
}

/** Every reporter file's walls in `dir`, unmerged: a file a retry re-ran
 *  appears once per invocation, and the reader decides. */
export function readFileWalls(dir: string): FileWall[] {
    if (!existsSync(dir)) return [];
    const all: FileWall[] = [];
    for (const f of readdirSync(dir)) {
        if (!f.endsWith(".json") || f === RUN_FILE) continue;
        try {
            all.push(...parseFileWalls(readFileSync(join(dir, f), "utf8")));
        } catch {
            // unreadable — advisory, skip it
        }
    }
    return all;
}

/**
 * One row per (project, test), its WORST ratio. A health run invokes vitest
 * more than once — the chain, then a retry of a failed project — and a test
 * that timed out and then passed on the retry is a near-miss: the timeout is
 * the measurement that matters.
 */
export function worstPerTest(records: readonly TestDuration[]): TestDuration[] {
    const worst = new Map<string, TestDuration>();
    for (const r of records) {
        const key = `${r.project}\u0000${r.test}`;
        const prev = worst.get(key);
        if (!prev || headroomRatio(r) > headroomRatio(prev)) worst.set(key, r);
    }
    return [...worst.values()];
}

/** Every reporter file in `dir`, merged by `worstPerTest`. */
export function readDurations(dir: string): TestDuration[] {
    if (!existsSync(dir)) return [];
    const all: TestDuration[] = [];
    for (const f of readdirSync(dir)) {
        if (!f.endsWith(".json") || f === RUN_FILE) continue;
        try {
            all.push(...parseDurationFile(readFileSync(join(dir, f), "utf8")));
        } catch {
            // unreadable — advisory, skip it
        }
    }
    return worstPerTest(all);
}

/** A finished run's directory (`<sha12>/` holding `run.json`), or null while
 *  it is still being written or when it is not one. */
export function readHeadroomRun(
    dir: string,
    sha12: string
): HeadroomRun | null {
    let meta: { machine?: unknown; ts?: unknown };
    try {
        meta = JSON.parse(readFileSync(join(dir, RUN_FILE), "utf8"));
    } catch {
        return null;
    }
    if (typeof meta.ts !== "number") return null;
    return {
        sha12,
        machine: typeof meta.machine === "string" ? meta.machine : "",
        ts: meta.ts,
        records: readDurations(dir),
    };
}

/** The tests above `threshold` of their budget, worst first. */
export function overHeadroom(
    records: readonly TestDuration[],
    threshold = HEADROOM_THRESHOLD
): TestDuration[] {
    return records
        .filter((r) => headroomRatio(r) > threshold)
        .sort(
            (a, b) =>
                headroomRatio(b) - headroomRatio(a) ||
                a.test.localeCompare(b.test)
        );
}

function secs(ms: number): string {
    return `${(ms / 1000).toFixed(1)}s`;
}

function pct(ratio: number): string {
    return `${Math.round(ratio * 100)}%`;
}

/**
 * The advisory line a health log ends with when a test ran above the
 * threshold, or null. A test name is free text: `(exit ` in it is rewritten
 * so the line can never read as a step's exit (`parseHealthLogRed`).
 */
export function headroomLine(
    records: readonly TestDuration[],
    threshold = HEADROOM_THRESHOLD
): string | null {
    const over = overHeadroom(records, threshold);
    if (over.length === 0) return null;
    const items = over.map(
        (r) =>
            `${r.test} [${r.project}] ${secs(r.durationMs)}/${secs(r.timeoutMs)} = ${pct(headroomRatio(r))}`
    );
    return `headroom: ${over.length} test(s) above ${pct(threshold)} of their testTimeout (advisory, issue #5484) — ${items.join("; ")}`.replace(
        /\(exit\b/g,
        "[exit"
    );
}

/** One row of `telemetry:latency --headroom`. */
export interface HeadroomViewRow {
    test: string;
    project: string;
    /** The worst ratio over the window, and the run that measured it. */
    ratio: number;
    durationMs: number;
    timeoutMs: number;
    machine: string;
    sha12: string;
    /** How many of the window's runs had it above the threshold. */
    runsOver: number;
}

/**
 * The tests above `threshold` in `runs` (the caller picks the last N), worst
 * ratio first, each with the machine that measured that worst.
 */
export function headroomView(
    runs: readonly HeadroomRun[],
    threshold = HEADROOM_THRESHOLD
): HeadroomViewRow[] {
    const rows = new Map<string, HeadroomViewRow>();
    for (const run of runs) {
        for (const r of overHeadroom(worstPerTest(run.records), threshold)) {
            const key = `${r.project}\u0000${r.test}`;
            const ratio = headroomRatio(r);
            const prev = rows.get(key);
            const runsOver = (prev?.runsOver ?? 0) + 1;
            if (prev && prev.ratio >= ratio) {
                prev.runsOver = runsOver;
                continue;
            }
            rows.set(key, {
                test: r.test,
                project: r.project,
                ratio,
                durationMs: r.durationMs,
                timeoutMs: r.timeoutMs,
                machine: run.machine,
                sha12: run.sha12,
                runsOver,
            });
        }
    }
    return [...rows.values()].sort(
        (a, b) => b.ratio - a.ratio || a.test.localeCompare(b.test)
    );
}

/** `headroomView` as the plain-text report `telemetry:latency` prints. */
export function formatHeadroomView(
    rows: readonly HeadroomViewRow[],
    runCount: number,
    threshold = HEADROOM_THRESHOLD
): string {
    const head = `  test timeout headroom — tests above ${pct(threshold)} of their testTimeout in the last ${runCount} health run(s) (issue #5484)`;
    if (rows.length === 0) return `${head}\n  none`;
    const lines = rows.map(
        (r) =>
            `  ${pct(r.ratio).padStart(5)}  ${secs(r.durationMs).padStart(7)}/${secs(r.timeoutMs)}  ` +
            `${r.machine || "?"} @ ${r.sha12.slice(0, 8)}  ${r.runsOver}/${runCount} runs  [${r.project}] ${r.test}`
    );
    return [head, ...lines].join("\n");
}
