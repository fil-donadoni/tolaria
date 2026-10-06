#!/usr/bin/env bun
/**
 * `bun scripts/convex-heap-probe.ts --deployment dev:<name>` — the per-call heap wall
 * of the compiled pool as an object literal, observed on a real Convex CLOUD
 * isolate instead of projected from Node (issue #4852, PRD issue #4849, ADR
 * 0113 Amendment IV). It calibrates `check:convex-heap`'s Node figures: the
 * ratio it prints is what the health heap budget applies.
 *
 * Per pool size (default 4k, 9k, 12k, 35k rows, synthesized from the committed
 * packed corpus with uniquified ids and names):
 *
 *   1. push a harness to the operator's THROWAWAY cloud dev deployment —
 *      `empty:run`, the control, and `pool:run`, a mutation whose module
 *      imports the pool as `pool.json` (the object literal the server carried
 *      until issue #4168); both first allocate `pad` chunks;
 *   2. call `pool:run` with no padding: does it succeed, or fail on memory
 *      (and with what text);
 *   3. interleave padless control and pool calls, round by round, and report
 *      the median and p90 of the pool's DIFFERENCE from the control;
 *   4. search the largest padding a pool call survives — its room left;
 *   5. measure the same pool module's heap in Node (method of
 *      `docs/research/convex-server-scale-2026-09-29.md`, via
 *      `scripts/lib/convex-heap.ts`), as a delta over the control.
 *
 * The control's room, searched once, is the whole 64 MiB wall: the pool's
 * isolate heap is the share of that room it took (`scripts/lib/
 * convex-heap-probe.ts` says why padding). The ratio isolate / Node is printed
 * per size, then the Markdown table for the research file.
 *
 * On demand only: outside every suite and every gate (it needs the network
 * and a deployment in the owner's Convex account). It never creates nor
 * deletes the deployment — `docs/guides/catalogue-cloud-latency.md` § 1 and
 * § 3 say how (same throwaway shape, same refusals as `perf:catalogue-cloud`).
 *
 * Flags:
 *   --deployment dev:<name>   the throwaway cloud dev deployment (required)
 *   --rows 4000,9000,12000,35000   pool sizes, one push each
 *   --rounds 20               measured latency rounds per size
 *   --warmup 3                discarded rounds after each push
 *   --work-dir <dir>          where the harness project is written
 *   --node-only               the Node half alone, no deployment
 */
import { spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { CardDefinition } from "../convex/cards/types";
import {
    PACKED_CORPUS_PATH,
    unpackCorpus,
    type PackedCorpus,
} from "./lib/packed-corpus";
import {
    deploymentRefusal,
    summarizeCase,
    synthesizeRows,
    verdictRefusal,
} from "./lib/catalogue-cloud-latency";
import { bundleModule, measureFileHeap } from "./lib/convex-heap";
import {
    CONVEX_CALL_RAM_BYTES,
    DEFAULT_PROBE_ROWS,
    EMPTY_MODULE,
    PAD_CHUNK_ELEMENTS,
    PAD_MODULE,
    POOL_MODULE,
    PROBE_FUNCTIONS,
    isMemoryFailure,
    largestSurviving,
    nodeToIsolateRatios,
    poolJson,
    resultTable,
    smallestFailingRows,
    type SizeResult,
} from "./lib/convex-heap-probe";

const repoRoot = resolve(import.meta.dir, "..");
const MIB = 1024 * 1024;

function flag(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

const intFlag = (name: string, fallback: number): number => {
    const raw = flag(name);
    const n = raw === undefined ? fallback : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--${name} must be a positive integer, got ${raw}`);
    }
    return n;
};

/** Every `CONVEX_DEPLOYMENT=` the repository's env files name — never a
 *  target (same rule as `perf:catalogue-cloud`). */
function repositoryDeployments(): string[] {
    const names: string[] = [];
    for (const file of readdirSync(repoRoot)) {
        if (!file.startsWith(".env")) continue;
        for (const line of readFileSync(join(repoRoot, file), "utf8").split(
            "\n"
        )) {
            const m = /^\s*CONVEX_DEPLOYMENT\s*=\s*["']?([^"'\s#]+)/.exec(line);
            if (m) names.push(m[1]!);
        }
    }
    return names;
}

/** This process's environment minus every deployment selector: bun loads the
 *  repository's `.env.local`, which would silently win over the harness's. */
function harnessEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
        if (k.startsWith("CONVEX_") || k === "VITE_CONVEX_URL") continue;
        env[k] = v;
    }
    return env;
}

function writeHarness(dir: string, deployment: string): void {
    mkdirSync(join(dir, "convex"), { recursive: true });
    const repoPackage = JSON.parse(
        readFileSync(join(repoRoot, "package.json"), "utf8")
    ) as { dependencies: Record<string, string> };
    writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
            name: "convex-heap-probe-harness",
            private: true,
            type: "module",
            dependencies: { convex: repoPackage.dependencies.convex },
        })
    );
    if (!existsSync(join(dir, "node_modules"))) {
        symlinkSync(join(repoRoot, "node_modules"), join(dir, "node_modules"));
    }
    writeFileSync(
        join(dir, ".env.harness"),
        `CONVEX_DEPLOYMENT=${deployment}\n`
    );
    writeFileSync(join(dir, "convex", "pad.ts"), PAD_MODULE);
    writeFileSync(join(dir, "convex", "empty.ts"), EMPTY_MODULE);
    writeFileSync(join(dir, "convex", "pool.ts"), POOL_MODULE);
}

/** Runs the Convex CLI against the harness; the exit status and output, never
 *  a throw — a refused push is a RESULT here (the module itself may not fit). */
function convexCli(
    dir: string,
    args: string[]
): { ok: boolean; stdout: string; output: string } {
    const bin = join(repoRoot, "node_modules", ".bin", "convex");
    const run = spawnSync(bin, [...args, "--env-file", ".env.harness"], {
        cwd: dir,
        env: harnessEnv(),
        encoding: "utf8",
        timeout: 900_000,
    });
    return {
        ok: run.status === 0,
        stdout: run.stdout ?? "",
        output: `${run.stdout ?? ""}\n${run.stderr ?? ""}`.trim(),
    };
}

function push(dir: string): { ok: boolean; output: string } {
    return convexCli(dir, [
        "dev",
        "--once",
        "--typecheck",
        "disable",
        "--codegen",
        "disable",
        "--tail-logs",
        "disable",
    ]);
}

const emptyRun = makeFunctionReference<"mutation">("empty:run");
const poolRun = makeFunctionReference<"mutation">("pool:run");

const message = (e: unknown): string =>
    e instanceof Error ? e.message : String(e);

/** One call: `null` on success, the error text on failure. */
async function attempt(
    client: ConvexHttpClient,
    fn: typeof emptyRun,
    pad: number
): Promise<string | null> {
    try {
        await client.mutation(fn, { pad });
        return null;
    } catch (e) {
        return message(e);
    }
}

/** Survival of a padded call, a failure confirmed by a second call (one
 *  unlucky GC is not a wall). A failure that does not name memory stops the
 *  run: the search would read a network error as "no room". */
function survivor(client: ConvexHttpClient, fn: typeof emptyRun) {
    return async (pad: number): Promise<boolean> => {
        for (let tries = 0; tries < 2; tries++) {
            const err = await attempt(client, fn, pad);
            if (err === null) return true;
            if (!isMemoryFailure(err)) {
                throw new Error(
                    `call with pad ${pad} failed on something other than memory: ${err}`
                );
            }
        }
        return false;
    };
}

async function timed(fn: () => Promise<unknown>): Promise<number> {
    const start = performance.now();
    await fn();
    return performance.now() - start;
}

/** Padless control and pool calls, order alternated per round. */
async function latency(
    client: ConvexHttpClient,
    rounds: number,
    warmup: number
): Promise<{ medianMs: number; p90Ms: number }> {
    const empty: number[] = [];
    const pool: number[] = [];
    for (let r = 0; r < warmup + rounds; r++) {
        const order = r % 2 === 0 ? [emptyRun, poolRun] : [poolRun, emptyRun];
        const t = new Map<typeof emptyRun, number>();
        for (const fn of order) {
            t.set(fn, await timed(() => client.mutation(fn, { pad: 0 })));
        }
        if (r < warmup) continue;
        empty.push(t.get(emptyRun)!);
        pool.push(t.get(poolRun)!);
    }
    const s = summarizeCase("pool", pool, empty);
    return { medianMs: s.medianMs, p90Ms: s.p90Ms };
}

/** Node heap of `pool.ts` over `empty.ts`, both bundled with the Convex CLI's
 *  own esbuild options, as the research file measures. */
async function nodePoolHeap(dir: string): Promise<number> {
    const out = join(dir, "node-bundle");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "package.json"), '{"type":"module"}');
    await bundleModule(join(dir, "convex", "empty.ts"), join(out, "empty.mjs"));
    await bundleModule(join(dir, "convex", "pool.ts"), join(out, "pool.mjs"));
    return (
        measureFileHeap(join(out, "pool.mjs")) -
        measureFileHeap(join(out, "empty.mjs"))
    );
}

/** Node bytes of one padding chunk: 256 chunks held at load, over none. */
function nodeChunkBytes(dir: string): number {
    const out = join(dir, "node-chunk");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "package.json"), '{"type":"module"}');
    const held = (n: number) =>
        `const held = []; for (let i = 0; i < ${n}; i++) held.push(new Array(${PAD_CHUNK_ELEMENTS}).fill(i)); globalThis.__held = held;\n`;
    writeFileSync(join(out, "none.mjs"), held(0));
    writeFileSync(join(out, "some.mjs"), held(256));
    return (
        (measureFileHeap(join(out, "some.mjs")) -
            measureFileHeap(join(out, "none.mjs"))) /
        256
    );
}

/** `--node-only`: the Node half alone, no deployment — the harness bundles,
 *  imports and measures, so a cloud run does not discover a broken harness. */
async function nodeOnly(
    dir: string,
    sizes: readonly number[]
): Promise<number> {
    writeHarness(dir, "dev:node-only");
    const committed = JSON.parse(
        readFileSync(resolve(repoRoot, PACKED_CORPUS_PATH), "utf8")
    ) as PackedCorpus;
    const base = unpackCorpus(committed);
    console.log(
        `padding chunk = ${(nodeChunkBytes(dir) / 1024).toFixed(0)} KiB in Node`
    );
    for (const rows of sizes) {
        const json = poolJson(synthesizeRows(base, rows));
        writeFileSync(join(dir, "convex", "pool.json"), json);
        const heap = await nodePoolHeap(dir);
        console.log(
            `${rows} rows: pool.json ${(json.length / MIB).toFixed(1)} MiB, Node heap +${(heap / MIB).toFixed(1)} MiB`
        );
    }
    return 0;
}

async function main(): Promise<number> {
    const deployment = flag("deployment") ?? "";
    const node = process.argv.includes("--node-only");
    const refused = node
        ? null
        : deploymentRefusal(deployment, repositoryDeployments());
    if (refused !== null) {
        console.error(`✗ probe:convex-heap: ${refused}`);
        return 2;
    }
    const sizes = (flag("rows") ?? DEFAULT_PROBE_ROWS.join(","))
        .split(",")
        .map(Number);
    if (sizes.some((n) => !Number.isInteger(n) || n <= 0)) {
        throw new Error(`--rows must list positive integers`);
    }
    const rounds = intFlag("rounds", 20);
    const warmup = intFlag("warmup", 3);
    const dir = realpathSync(
        flag("work-dir") ?? mkdtempSync(join(tmpdir(), "convex-heap-probe-"))
    );
    try {
        if (node) return await nodeOnly(dir, sizes);
        return await probe(dir, deployment, sizes, rounds, warmup);
    } finally {
        if (flag("work-dir") === undefined) rmSync(dir, { recursive: true });
        if (!node)
            console.log(
                `\nThe deployment ${deployment} is still there — delete its throwaway project ` +
                    "(docs/guides/catalogue-cloud-latency.md § 3)."
            );
    }
}

async function probe(
    dir: string,
    deployment: string,
    sizes: readonly number[],
    rounds: number,
    warmup: number
): Promise<number> {
    writeHarness(dir, deployment);
    const spec = convexCli(dir, ["function-spec"]);
    if (!spec.ok)
        throw new Error(`convex function-spec failed:\n${spec.output}`);
    const deployed = (
        JSON.parse(spec.stdout) as { functions: { identifier: string }[] }
    ).functions.map((f) => f.identifier);
    const foreign = deployed.filter(
        (f) =>
            !PROBE_FUNCTIONS.includes(f) &&
            // An earlier `perf:catalogue-cloud` harness on the same throwaway.
            !["corpus.js:lookup"].includes(f)
    );
    if (foreign.length > 0) {
        console.error(
            `✗ probe:convex-heap: refusing ${deployment}: it serves ${foreign.length} function(s) ` +
                `the harness does not (first: ${foreign[0]}) — use a throwaway project`
        );
        return 2;
    }

    const committed = JSON.parse(
        readFileSync(resolve(repoRoot, PACKED_CORPUS_PATH), "utf8")
    ) as PackedCorpus;
    const base = unpackCorpus(committed);
    const chunk = nodeChunkBytes(dir);
    console.log(
        `probe:convex-heap — pools of ${sizes.join(", ")} rows from ${base.length} real ones; ` +
            `padding chunk = ${(chunk / 1024).toFixed(0)} KiB in Node; harness in ${dir}`
    );

    let control: number | undefined;
    const results: SizeResult[] = [];
    for (const rows of sizes) {
        const pool: CardDefinition[] = synthesizeRows(base, rows);
        const json = poolJson(pool);
        writeFileSync(join(dir, "convex", "pool.json"), json);
        const nodeHeapBytes = await nodePoolHeap(dir);
        console.log(
            `\n▸ ${rows} rows: pool.json ${(json.length / MIB).toFixed(1)} MiB, ` +
                `Node heap +${(nodeHeapBytes / MIB).toFixed(1)} MiB — pushing…`
        );
        const pushed = push(dir);
        if (!pushed.ok) {
            const tail = pushed.output.split("\n").slice(-15).join("\n");
            console.log(`  push FAILED:\n${tail}`);
            results.push({
                rows,
                sourceBytes: json.length,
                nodeHeapBytes,
                pushError: tail,
            });
            continue;
        }
        const where = convexCli(dir, ["run", "empty:where"]);
        let url: string | undefined;
        try {
            url =
                (JSON.parse(where.stdout.trim() || "null") as string | null) ??
                undefined;
        } catch {
            url = undefined;
        }
        const refusal = verdictRefusal(url);
        if (refusal !== null) {
            console.error(`✗ probe:convex-heap: ${refusal}`);
            return 2;
        }
        const client = new ConvexHttpClient(url!);

        if (control === undefined) {
            control = await largestSurviving(survivor(client, emptyRun));
            console.log(
                `  control room: ${control} chunks ≈ ${((control * chunk) / MIB).toFixed(1)} MiB ` +
                    `at Node's chunk size (wall ${CONVEX_CALL_RAM_BYTES / MIB} MiB)`
            );
            if (control <= 0) throw new Error("the control call has no room");
        }

        const callError = (await attempt(client, poolRun, 0)) ?? undefined;
        if (callError !== undefined && !isMemoryFailure(callError)) {
            throw new Error(
                `padless pool call failed on something other than memory: ${callError}`
            );
        }
        if (callError !== undefined) {
            console.log(`  padless call FAILED: ${callError}`);
            results.push({
                rows,
                sourceBytes: json.length,
                nodeHeapBytes,
                callError,
                roomChunks: -1,
            });
            continue;
        }
        const lat = await latency(client, rounds, warmup);
        const room = await largestSurviving(survivor(client, poolRun));
        console.log(
            `  ok — latency +${lat.medianMs.toFixed(1)} / +${lat.p90Ms.toFixed(1)} ms (median / p90), ` +
                `room ${room} of ${control} chunks`
        );
        results.push({
            rows,
            sourceBytes: json.length,
            nodeHeapBytes,
            roomChunks: room,
            latencyMedianMs: lat.medianMs,
            latencyP90Ms: lat.p90Ms,
        });
    }

    if (control === undefined) {
        console.log("\nNo size could be pushed: no control room, no ratio.");
        console.log(resultTable(1, results));
        return 1;
    }
    console.log(`\n${resultTable(control, results)}`);
    const ratios = nodeToIsolateRatios(control, results);
    console.log(
        ratios.length === 0
            ? "\nNode→isolate ratio: none usable (no size both succeeded and measured)"
            : `\nNode→isolate ratio (isolate / Node): ${ratios.map((r) => `${r.rows}: ${r.ratio.toFixed(2)}`).join(", ")}`
    );
    const failing = smallestFailingRows(results);
    console.log(
        `smallest failing size: ${failing === null ? "none of those pushed" : failing.toLocaleString("en-US")}`
    );
    console.log(
        `control room × Node chunk = ${((control * chunk) / MIB).toFixed(1)} MiB ` +
            `(≈ ${CONVEX_CALL_RAM_BYTES / MIB} → same chunk layout; ≈ ${(2 * CONVEX_CALL_RAM_BYTES) / MIB} → the isolate compresses pointers and Node does not)`
    );
    return 0;
}

process.exit(await main());
