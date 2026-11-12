/**
 * `bun run blade:census` — one arm of a blade flip census, run by a pool of
 * workers over (entry, seed) jobs (issue #9276).
 *
 *   bun run blade:census --variant no-saturation-prior --jobs 7 --out base.json
 *   bun run blade:census --match "Caustic Bronco" --iterations 2000
 *   bun run blade:census --entries sensitive.txt --fail-fast --out screen.json
 *   bun run blade:census --diff base.json variant.json
 *   bun run blade:census --merge all.json slice-1.json slice-2.json …
 *
 * Arm options: `--tier must|stretch` (default must), `--variant <name>` (a
 * `LADDER_VARIANTS` name or `no-rule:<mechanism>`; absent = production
 * defaults), `--match <regex>`, `--entries <file>` (one exact label per
 * line), `--iterations <n>` (overrides every declared budget), `--fail-fast`
 * (an entry stops after its first red seed: screening), `--slice i/n` (a
 * static slice, for the hosted matrix), `--jobs <n>` (default ncpu - 1),
 * `--out <file>` (default `blade-census.json`).
 *
 * Thin by design, like `blade-audit-census.ts`: the registry cannot be loaded
 * from a `scripts/` entry (it drags `lib.dom` into the scripts project), so
 * each worker is a vitest run of `census.spec.ts` that claims jobs from a
 * shared work directory; this script only spawns them, waits, and reads the
 * rows back.
 *
 * Exit 0: the census completed (its reds are the answer, not a failure).
 * Exit 2: a worker crashed or a job wrote no row — nothing to conclude.
 */
import { spawn, spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    writeFileSync,
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
    diffCensus,
    formatCensusDiff,
    formatCensusSummary,
    mergeCensusResults,
    parseSlice,
    type CensusConfig,
    type CensusResult,
    type CensusRow,
} from "../convex/gre/ai/blade/census";

const SPEC = "convex/gre/ai/blade/__tests__/census.spec.ts";

function readResult(path: string): CensusResult {
    return JSON.parse(readFileSync(path, "utf8")) as CensusResult;
}

function fail(message: string, code = 1): never {
    console.error(`blade:census: ${message}`);
    process.exit(code);
}

type Args = {
    config: CensusConfig;
    jobs: number;
    out: string;
    diff?: [string, string];
    merge?: { out: string; inputs: string[] };
};

function parseArgs(argv: string[]): Args {
    const config: CensusConfig = { tier: "must" };
    let jobs = Math.max(1, availableParallelism() - 1);
    let out = "blade-census.json";
    const next = (i: number, flag: string) => {
        const v = argv[i + 1];
        if (v === undefined) fail(`${flag} needs a value`);
        return v;
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        switch (a) {
            case "--diff":
                return {
                    config,
                    jobs,
                    out,
                    diff: [next(i, a), next(i + 1, a)],
                };
            case "--merge": {
                const rest = argv.slice(i + 1);
                if (rest.length < 2) fail("--merge needs <out> <in…>");
                return {
                    config,
                    jobs,
                    out,
                    merge: { out: rest[0], inputs: rest.slice(1) },
                };
            }
            case "--tier": {
                const t = next(i++, a);
                if (t !== "must" && t !== "stretch") fail(`unknown tier ${t}`);
                config.tier = t;
                break;
            }
            case "--variant":
                config.variant = next(i++, a) || undefined;
                break;
            case "--match":
                config.match = next(i++, a) || undefined;
                break;
            case "--entries":
                config.entries = readFileSync(next(i++, a), "utf8")
                    .split("\n")
                    .map((l) => l.trim())
                    .filter((l) => l.length > 0 && !l.startsWith("#"));
                break;
            case "--iterations": {
                const raw = next(i++, a);
                if (raw === "") break;
                const n = Number(raw);
                if (!Number.isInteger(n) || n <= 0)
                    fail(`bad --iterations ${raw}`);
                config.iterations = n;
                break;
            }
            case "--fail-fast":
                config.failFast = true;
                break;
            case "--slice":
                config.slice = parseSlice(next(i++, a));
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
                fail(`unknown argument ${a}`);
        }
    }
    return { config, jobs, out };
}

function headSha(): string | null {
    const r = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : null;
}

function runWorker(dir: string, k: number): Promise<number> {
    return new Promise((done) => {
        const log = join(dir, `worker-${k}.log`);
        const child = spawn(
            "bunx",
            ["vitest", "run", "--config", "vitest.blade.config.ts", SPEC],
            {
                env: {
                    ...process.env,
                    BLADE_CENSUS_DIR: dir,
                    // One vitest worker per process: the pool is the processes.
                    TOLARIA_VITEST_WORKERS: "1",
                },
                stdio: ["ignore", "pipe", "pipe"],
            }
        );
        const chunks: Buffer[] = [];
        child.stdout.on("data", (c: Buffer) => chunks.push(c));
        child.stderr.on("data", (c: Buffer) => chunks.push(c));
        child.on("close", (code) => {
            writeFileSync(log, Buffer.concat(chunks));
            done(code ?? 1);
        });
    });
}

async function runArm(args: Args): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), "blade-census-"));
    writeFileSync(join(dir, "config.json"), JSON.stringify(args.config));
    const started = Date.now();
    const progress = setInterval(() => {
        const rows = existsSync(join(dir, "rows"))
            ? readdirSync(join(dir, "rows")).length
            : 0;
        const plan = existsSync(join(dir, "plan.json"))
            ? (
                  JSON.parse(readFileSync(join(dir, "plan.json"), "utf8")) as {
                      jobs: number[];
                  }
              ).jobs.length
            : "?";
        console.log(
            `blade:census: ${rows}/${plan} jobs, ${Math.round((Date.now() - started) / 1000)}s`
        );
    }, 30_000);
    const codes = await Promise.all(
        Array.from({ length: args.jobs }, (_, k) => runWorker(dir, k))
    );
    clearInterval(progress);
    const wallMs = Date.now() - started;

    const crashed = codes.map((c, k) => ({ c, k })).filter(({ c }) => c !== 0);
    if (!existsSync(join(dir, "plan.json")) || crashed.length > 0) {
        for (const { k } of crashed.length ? crashed : [{ k: 0 }]) {
            const log = join(dir, `worker-${k}.log`);
            const tail = existsSync(log)
                ? readFileSync(log, "utf8").split("\n").slice(-30).join("\n")
                : "(no log)";
            console.error(`--- worker ${k} (exit ${codes[k]}) ---\n${tail}`);
        }
        fail(`worker failure; logs in ${dir}`, 2);
    }
    const plan = (
        JSON.parse(readFileSync(join(dir, "plan.json"), "utf8")) as {
            jobs: number[];
        }
    ).jobs;
    // An empty slice is legal (a small selection over many slices): it
    // writes an empty arm the merge sums. An empty unsliced selection is a
    // typo'd --match, never a census.
    if (plan.length === 0 && !args.config.slice)
        fail("the selection holds no job (check --match / --tier)");
    const rows: CensusRow[] = [];
    const missing: number[] = [];
    for (const id of plan) {
        const p = join(dir, "rows", `${id}.json`);
        if (!existsSync(p)) missing.push(id);
        else rows.push(JSON.parse(readFileSync(p, "utf8")) as CensusRow);
    }
    if (missing.length > 0) {
        fail(
            `${missing.length} jobs wrote no row (${missing.slice(0, 10).join(", ")}…); logs in ${dir}`,
            2
        );
    }
    const c = args.config;
    const result: CensusResult = {
        meta: {
            tier: c.tier,
            variant: c.variant ?? null,
            match: c.match ?? null,
            iterations: c.iterations ?? null,
            failFast: c.failFast ?? false,
            slices: [c.slice ? `${c.slice.index}/${c.slice.count}` : "1/1"],
            jobs: plan.length,
            wallMs,
            cpuMs: rows.reduce((n, r) => n + r.ms, 0),
            workers: args.jobs,
            sha: headSha(),
        },
        rows,
    };
    const out = resolve(args.out);
    mkdirSync(resolve(out, ".."), { recursive: true });
    writeFileSync(out, JSON.stringify(result, null, 1));
    console.log(formatCensusSummary(result));
    console.log(`rows: ${out}`);
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (args.diff) {
        const [a, b] = args.diff;
        console.log(formatCensusDiff(diffCensus(readResult(a), readResult(b))));
        return;
    }
    if (args.merge) {
        const merged = mergeCensusResults(args.merge.inputs.map(readResult));
        writeFileSync(args.merge.out, JSON.stringify(merged, null, 1));
        console.log(formatCensusSummary(merged));
        return;
    }
    await runArm(args);
}

await main();
