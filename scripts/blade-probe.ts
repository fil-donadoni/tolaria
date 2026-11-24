/**
 * `bun run blade:probe <label>` — the authoring check for one blade entry
 * (issue #10631): is its answer CLEAR, or green by the seeds it was written
 * with? Run by hand before an entry is committed.
 *
 *   bun run blade:probe "my new entry"
 *   bun run blade:probe "my new entry" --variant no-saturation-prior
 *   bun run blade:probe "my new entry" --seeds 40 --jobs 4 --out probe.json
 *
 * One table: pass counts over `--seeds` wide seeds (default 20) at half, the
 * declared and double budget; the robustness audit's classification with the
 * deciding mechanism of every run; the same count under `--variant` (a
 * discriminating pair reads "base N/N, variant 0/N"); the rollout width of
 * the position. The last line is the `must` admission: ROBUST and at least
 * 19 of 20 seeds at the declared budget.
 *
 * Thin like `blade-census.ts`: the registry cannot be loaded from a `scripts/`
 * entry, so the runs happen in the pooled worker spec
 * `convex/gre/ai/blade/__tests__/probe.spec.ts`; this script spawns the pool,
 * waits and prints `formatProbeReport` over the rows.
 *
 * Exit 0: the probe completed (an unadmitted entry is the answer, not a
 * failure). Exit 2: a worker crashed or a cell wrote no row.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
    PROBE_DEFAULT_SEEDS,
    formatProbeReport,
    summarizeProbe,
    type ProbeConfig,
    type ProbeEntry,
    type ProbeRow,
} from "../convex/gre/ai/blade/probe";
import {
    crashedWorkerTails,
    runBladeWorkerPool,
} from "./lib/blade-worker-pool";

const SPEC = "convex/gre/ai/blade/__tests__/probe.spec.ts";

function fail(message: string, code = 1): never {
    console.error(`blade:probe: ${message}`);
    process.exit(code);
}

type Args = { config: ProbeConfig; jobs: number; out: string | null };

function parseArgs(argv: string[]): Args {
    let label: string | undefined;
    let seeds = PROBE_DEFAULT_SEEDS;
    let variant: string | undefined;
    let jobs = Math.max(1, availableParallelism() - 1);
    let out: string | null = null;
    const next = (i: number, flag: string) => {
        const v = argv[i + 1];
        if (v === undefined) fail(`${flag} needs a value`);
        return v;
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        switch (a) {
            case "--seeds": {
                const n = Number(next(i++, a));
                if (!Number.isInteger(n) || n < 1) fail(`bad --seeds`);
                seeds = n;
                break;
            }
            case "--variant":
                variant = next(i++, a) || undefined;
                break;
            case "--jobs": {
                const n = Number(next(i++, a));
                if (!Number.isInteger(n) || n < 1) fail(`bad --jobs`);
                jobs = n;
                break;
            }
            case "--out":
                out = next(i++, a);
                break;
            default:
                if (a.startsWith("--")) fail(`unknown argument ${a}`);
                if (label !== undefined) fail(`one label only (got "${a}")`);
                label = a;
        }
    }
    if (!label)
        fail(
            `usage: blade:probe <label> [--variant <name>] [--seeds N] [--jobs n] [--out file]`
        );
    return { config: { label, seeds, variant }, jobs, out };
}

function headSha(): string | null {
    const r = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : null;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const dir = mkdtempSync(join(tmpdir(), "blade-probe-"));
    writeFileSync(join(dir, "config.json"), JSON.stringify(args.config));
    const codes = await runBladeWorkerPool(
        SPEC,
        "BLADE_PROBE_DIR",
        dir,
        args.jobs
    );
    const planPath = join(dir, "plan.json");
    if (!existsSync(planPath) || codes.some((c) => c !== 0)) {
        console.error(crashedWorkerTails(dir, codes));
        fail(`worker failure; logs in ${dir}`, 2);
    }
    const plan = JSON.parse(readFileSync(planPath, "utf8")) as {
        entry: ProbeEntry;
        jobs: number[];
    };
    const rows: ProbeRow[] = [];
    const missing: number[] = [];
    for (const id of plan.jobs) {
        const p = join(dir, "rows", `${id}.json`);
        if (!existsSync(p)) missing.push(id);
        else rows.push(JSON.parse(readFileSync(p, "utf8")) as ProbeRow);
    }
    if (missing.length > 0) {
        fail(`${missing.length} cells wrote no row; logs in ${dir}`, 2);
    }
    const report = summarizeProbe(plan.entry, args.config, rows, headSha());
    if (args.out) {
        writeFileSync(
            resolve(args.out),
            JSON.stringify({ report, rows }, null, 1)
        );
    }
    console.log(formatProbeReport(report));
}

await main();
