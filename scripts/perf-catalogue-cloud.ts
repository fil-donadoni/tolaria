#!/usr/bin/env bun
/**
 * `bun run perf:catalogue-cloud --deployment dev:<name>` — what a request pays
 * for the catalogue on a Convex CLOUD deployment (issue #4167, PRD issue
 * #4161, ADR 0113 Amendment III § Decision 5).
 *
 * A local number is not a verdict: cloud CPU measured ~2x slower than the dev
 * machine, and only cloud is what a player feels. So, per swept block size:
 *
 *   1. pack the catalogue, synthesized to ~35k rows (uniquified ids and
 *      names) from the committed packed corpus, with that block size;
 *   2. push a measurement harness to the operator's THROWAWAY cloud dev
 *      deployment — `empty:run`, a mutation that imports nothing, and
 *      `corpus:lookup`, a mutation whose module imports the packed corpus and
 *      resolves ids through the server's own decoder
 *      (`convex/cards/packedCorpus.ts`);
 *   3. interleave, round by round, the empty mutation with lookups of 0, 1 and
 *      a deck's worth of definitions, and report the median and p90 of each
 *      case's DIFFERENCE from the empty mutation of the same round;
 *   4. print the verdict against the 100 ms budget.
 *
 * On demand only: outside every suite and every gate (it needs the network
 * and a deployment in the owner's Convex account). It never deletes the
 * deployment — the CLI cannot; `docs/guides/catalogue-cloud-latency.md` says
 * how to create and how to clean up the throwaway project.
 *
 * Flags:
 *   --deployment dev:<name>   the throwaway cloud dev deployment (required)
 *   --blocks 8,16,32,64       block sizes to sweep
 *   --rows 35000              synthetic catalogue size
 *   --deck 76                 definitions the "deck" case asks for
 *   --rounds 40               measured rounds per block size
 *   --warmup 5                discarded rounds after each push
 *   --work-dir <dir>          where the harness project is written
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
import { join, relative, resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { CardDefinition } from "../convex/cards/types";
import {
    PACKED_CORPUS_PATH,
    packCorpus,
    serializePackedCorpus,
    unpackCorpus,
    type PackedCorpus,
} from "./lib/packed-corpus";
import {
    CATALOGUE_LATENCY_BUDGET_MS,
    DEFAULT_DECK_DEFINITIONS,
    DEFAULT_SWEEP_BLOCK_ROWS,
    DEFAULT_SYNTHETIC_ROWS,
    catalogueVerdict,
    deckIds,
    deploymentRefusal,
    summarizeCase,
    synthesizeRows,
    verdictRefusal,
    type CaseSummary,
} from "./lib/catalogue-cloud-latency";

const repoRoot = resolve(import.meta.dir, "..");

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

/** Every `CONVEX_DEPLOYMENT=` the repository's env files name — the
 *  deployments the app itself runs on, which the harness must never replace. */
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

/** The child's environment: this process's, minus every deployment
 *  selector. Bun loads the repository's `.env.local` into `process.env`,
 *  which points at the local backend — inherited, it would silently win over
 *  the harness's own env file. */
function harnessEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
        if (k.startsWith("CONVEX_") || k === "VITE_CONVEX_URL") continue;
        env[k] = v;
    }
    return env;
}

const DECODER_PATH = resolve(repoRoot, "convex/cards/packedCorpus.ts");

function writeHarness(dir: string, deployment: string): void {
    mkdirSync(join(dir, "convex"), { recursive: true });
    // The CLI refuses to push from a project that does not depend on `convex`;
    // the version is the repository's, resolved through the symlink below.
    const repoPackage = JSON.parse(
        readFileSync(join(repoRoot, "package.json"), "utf8")
    ) as { dependencies: Record<string, string> };
    writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
            name: "catalogue-latency-harness",
            private: true,
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
    writeFileSync(
        join(dir, "convex", "empty.ts"),
        `import { mutationGeneric, queryGeneric } from "convex/server";
// The baseline: a mutation whose module imports nothing.
export const run = mutationGeneric({ args: {}, handler: async () => null });
// Where the deployment says it is — the verdict's evidence, not the operator's word.
export const where = queryGeneric({
    args: {},
    handler: async () => process.env.CONVEX_CLOUD_URL ?? null,
});
`
    );
    const decoder = relative(join(dir, "convex"), DECODER_PATH)
        .replace(/\\/g, "/")
        .replace(/\.ts$/, "");
    writeFileSync(
        join(dir, "convex", "corpus.ts"),
        `import { mutationGeneric } from "convex/server";
import { v } from "convex/values";
// The server's own decoder, not a copy of it.
import { createPackedLookup } from "${decoder.startsWith(".") ? decoder : `./${decoder}`}";
import packed from "./packed.json";
export const lookup = mutationGeneric({
    args: { ids: v.array(v.string()) },
    handler: async (_ctx, { ids }) => {
        const corpus = createPackedLookup(packed as never);
        let found = 0;
        for (const id of ids) if (corpus.lookup(id) !== null) found++;
        return { found, inflations: corpus.inflations() };
    },
});
`
    );
}

function convexCli(dir: string, args: string[]): string {
    const bin = join(repoRoot, "node_modules", ".bin", "convex");
    const run = spawnSync(bin, [...args, "--env-file", ".env.harness"], {
        cwd: dir,
        env: harnessEnv(),
        encoding: "utf8",
        timeout: 600_000,
    });
    if (run.status !== 0) {
        throw new Error(
            `convex ${args[0]} failed (exit ${run.status}):\n${run.stdout}\n${run.stderr}`
        );
    }
    return run.stdout;
}

const emptyRun = makeFunctionReference<"mutation">("empty:run");
const corpusLookup = makeFunctionReference<"mutation">("corpus:lookup");

async function timed(fn: () => Promise<unknown>): Promise<number> {
    const start = performance.now();
    await fn();
    return performance.now() - start;
}

interface Case {
    readonly label: string;
    readonly ids: readonly string[];
}

async function measure(
    client: ConvexHttpClient,
    cases: readonly Case[],
    rounds: number,
    warmup: number
): Promise<CaseSummary[]> {
    const empty: number[] = [];
    const samples = cases.map(() => [] as number[]);
    for (let r = 0; r < warmup + rounds; r++) {
        // Rotate the order every round so no case always follows the empty
        // call (a connection kept warm by its predecessor would favour it).
        const order = [-1, ...cases.map((_, i) => i)];
        const shift = r % order.length;
        const rotated = [...order.slice(shift), ...order.slice(0, shift)];
        const round = new Map<number, number>();
        for (const k of rotated) {
            round.set(
                k,
                await timed(() =>
                    k < 0
                        ? client.mutation(emptyRun, {})
                        : client.mutation(corpusLookup, { ids: cases[k]!.ids })
                )
            );
        }
        if (r < warmup) continue;
        empty.push(round.get(-1)!);
        cases.forEach((_, i) => samples[i]!.push(round.get(i)!));
    }
    return cases.map((c, i) => summarizeCase(c.label, samples[i]!, empty));
}

const fmt = (ms: number): string => `${ms >= 0 ? "+" : ""}${ms.toFixed(1)} ms`;

async function main(): Promise<number> {
    const deployment = flag("deployment") ?? "";
    const refused = deploymentRefusal(deployment, repositoryDeployments());
    if (refused !== null) {
        console.error(`✗ perf:catalogue-cloud: ${refused}`);
        return 2;
    }
    const blocks = (flag("blocks") ?? DEFAULT_SWEEP_BLOCK_ROWS.join(","))
        .split(",")
        .map(Number);
    if (blocks.some((b) => !Number.isInteger(b) || b <= 0)) {
        throw new Error(`--blocks must list positive integers`);
    }
    const rowCount = intFlag("rows", DEFAULT_SYNTHETIC_ROWS);
    const deck = intFlag("deck", DEFAULT_DECK_DEFINITIONS);
    const rounds = intFlag("rounds", 40);
    const warmup = intFlag("warmup", 5);
    const dir =
        // Resolved through symlinks (macOS's tmpdir is `/var` → `/private/var`), or
        // the decoder's relative import path below would climb out of the wrong root.
        realpathSync(
            flag("work-dir") ??
                mkdtempSync(join(tmpdir(), "catalogue-latency-"))
        );

    const committed = JSON.parse(
        readFileSync(resolve(repoRoot, PACKED_CORPUS_PATH), "utf8")
    ) as PackedCorpus;
    const rows = synthesizeRows(unpackCorpus(committed), rowCount);
    const ids = deckIds(rows, deck);
    const cases: Case[] = [
        { label: "0 definitions", ids: [] },
        { label: "1 definition", ids: ids.slice(0, 1) },
        { label: `${deck} definitions`, ids },
    ];
    console.log(
        `perf:catalogue-cloud — ${rows.length} rows (${committed.rowCount} real, uniquified), ` +
            `${rounds} rounds (+${warmup} warm-up) per block size, harness in ${dir}`
    );

    try {
        return await sweep(dir, deployment, rows, ids, cases, blocks, {
            rounds,
            warmup,
            sourceHash: committed.sourceHash,
        });
    } finally {
        if (flag("work-dir") === undefined) rmSync(dir, { recursive: true });
        console.log(
            `\nThe deployment ${deployment} is still there — delete its throwaway project ` +
                "(docs/guides/catalogue-cloud-latency.md § Clean up)."
        );
    }
}

/** Push and measure every block size; 0 when every one PASSes, 1 on a FAIL,
 *  2 — before a single measured round — when the deployment is not cloud. */
async function sweep(
    dir: string,
    deployment: string,
    rows: readonly CardDefinition[],
    ids: readonly string[],
    cases: readonly Case[],
    blocks: readonly number[],
    opts: { rounds: number; warmup: number; sourceHash: string }
): Promise<number> {
    writeHarness(dir, deployment);
    let failed = false;
    const table: string[] = [];
    for (const blockRows of blocks) {
        const bytes = serializePackedCorpus(
            packCorpus(rows, opts.sourceHash, blockRows)
        );
        writeFileSync(join(dir, "convex", "packed.json"), bytes);
        console.log(
            `\n▸ block size ${blockRows}: ${bytes.length} B packed — pushing…`
        );
        convexCli(dir, [
            "dev",
            "--once",
            "--typecheck",
            "disable",
            "--codegen",
            "disable",
            "--tail-logs",
            "disable",
        ]);
        const reported = convexCli(dir, ["run", "empty:where"]).trim();
        let url: string | undefined;
        try {
            url =
                (JSON.parse(reported || "null") as string | null) ?? undefined;
        } catch {
            url = undefined;
        }
        // The deployment's own word decides, before anything is measured: a
        // local or self-hosted number is not worth printing at all.
        const refusal = verdictRefusal(url);
        if (refusal !== null) {
            console.error(`✗ perf:catalogue-cloud: ${refusal}`);
            return 2;
        }
        const client = new ConvexHttpClient(url!);
        const check = (await client.mutation(corpusLookup, { ids })) as {
            found: number;
            inflations: number;
        };
        if (check.found !== ids.length) {
            throw new Error(
                `harness resolved ${check.found} of ${ids.length} deck ids — the pushed corpus is not the packed one`
            );
        }
        const summaries = await measure(
            client,
            cases,
            opts.rounds,
            opts.warmup
        );
        for (const s of summaries) {
            console.log(
                `  ${s.label.padEnd(16)} median ${fmt(s.medianMs).padStart(10)}   p90 ${fmt(s.p90Ms).padStart(10)}`
            );
        }
        const verdict = catalogueVerdict(summaries);
        failed ||= verdict === "FAIL";
        console.log(
            `  budget ${CATALOGUE_LATENCY_BUDGET_MS} ms (median) — ${verdict}` +
                ` (${check.inflations} blocks inflated by the deck case)`
        );
        table.push(
            `| ${blockRows} | ${bytes.length.toLocaleString("en-US")} | ${(bytes.length / rows.length).toFixed(0)} | ` +
                summaries
                    .map((s) => `${fmt(s.medianMs)} / ${fmt(s.p90Ms)}`)
                    .join(" | ") +
                ` | ${verdict} |`
        );
    }

    console.log(
        `\n| block rows | packed bytes | B/row | ${cases.map((c) => `${c.label} (median / p90)`).join(" | ")} | verdict |`
    );
    console.log(`|${" --- |".repeat(4 + cases.length)}`);
    for (const line of table) console.log(line);
    return failed ? 1 : 0;
}

process.exit(await main());
