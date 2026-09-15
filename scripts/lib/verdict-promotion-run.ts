// `bun run verdicts:validate` and `bun run verdicts:promote` — the store I/O,
// the writes, and the order they happen in (issue #3583, PRD #3574, ADR 0128
// §7).
//
// THE SHAPE. This module snapshots the Verdict Store (every verdict object and
// attestation, read-only), hands it to the ENGINE STEP — which classifies,
// plans the lock and fits it, and lives behind the blade vitest config for the
// reason `convex/gre/ai/blade/verdictPromotion.ts` gives — and then, for a
// promotion, does the writing:
//
//   1. a no-op (nothing new, nothing dropped, same pack) writes NOTHING and
//      runs nothing further;
//   2. the pack is written by a DEPLOYMENT (`verdictsPack:writePack`): this
//      machine holds only the reader's key (two credentials, never one);
//   3. the hash the deployment reports must be the one this snapshot encodes
//      to, and the pack is then read back through the gate's own verified path
//      (`loadLockedVerdicts`) — believed, like everything else, only once it
//      re-hashes;
//   4. only then are the lock AND `DEFAULT_EVAL_WEIGHTS` written, together:
//      widening the lock and moving the weights are one change, and the
//      reproducibility guard is red on a checkout holding one without the
//      other;
//   5. the blade `must` tier runs on the rewritten weights, and its result is
//      the report's last section.
//
// Every step is a port, so the order and the refusals are exercised against
// the in-memory store (`scripts/__tests__/verdict-promotion-run.bot.test.ts`);
// the bindings at the bottom — `vitest`, `convex run`, `bun run test:blade` —
// are the thin untested plumbing.
//
// Imports the verdicts modules by file, never the index: the index reaches the
// blade registry and `lib.dom` (`lockedCorpus.ts` says how).

import { spawnSync } from "node:child_process";
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERDICT_LOCK_PATH } from "../../convex/gre/ai/verdicts/lockSource";
import {
    EVAL_WEIGHTS_PATH,
    VERDICT_PROMOTION_IN_ENV,
    VERDICT_PROMOTION_OUT_ENV,
    type VerdictPromotionInput,
    type VerdictPromotionOutput,
} from "../../convex/gre/ai/verdicts/promotion";
import {
    ATTESTATION_OBJECT_PREFIX,
    VERDICT_OBJECT_PREFIX,
    type VerdictStoreReader,
} from "../../convex/verdictStore";
import { convexRunErrorMessage } from "./convex-run-error";
import { resolveSeedTarget } from "./seed-preset-run";
import { loadLockedVerdicts } from "./verdict-pack-cache";

/** Parallel GETs while snapshotting — a listing of thousands is thousands of
 *  objects, and an unbounded fan-out is a self-inflicted rate limit. */
const GET_CONCURRENCY = 16;

async function readPrefix(
    reader: VerdictStoreReader,
    prefix: string
): Promise<VerdictPromotionInput["verdictObjects"]> {
    const names = await reader.list(prefix);
    const out: VerdictPromotionInput["verdictObjects"] = [];
    for (let i = 0; i < names.length; i += GET_CONCURRENCY) {
        const batch = await Promise.all(
            names.slice(i, i + GET_CONCURRENCY).map(async (name) => {
                const bytes = await reader.get(name);
                if (bytes === null) {
                    throw new Error(
                        `the Verdict Store listed ${name}, then held no such object`
                    );
                }
                return { name, base64: Buffer.from(bytes).toString("base64") };
            })
        );
        out.push(...batch);
    }
    return out;
}

/** The engine step's input: the checkout's lock and weights, and every verdict
 *  object and attestation the store lists. */
export async function snapshotVerdictStore(
    reader: VerdictStoreReader,
    root: string,
    mode: VerdictPromotionInput["mode"]
): Promise<VerdictPromotionInput> {
    const lockFile = join(root, VERDICT_LOCK_PATH);
    return {
        mode,
        lock: existsSync(lockFile) ? readFileSync(lockFile, "utf8") : null,
        evalWeightsSource: readFileSync(join(root, EVAL_WEIGHTS_PATH), "utf8"),
        verdictObjects: await readPrefix(reader, VERDICT_OBJECT_PREFIX),
        attestationObjects: await readPrefix(reader, ATTESTATION_OBJECT_PREFIX),
    };
}

export type BladeMustResult = { passed: boolean; summary: string };

export type VerdictsValidatePorts = {
    root: string;
    reader: VerdictStoreReader;
    engineStep: (
        input: VerdictPromotionInput
    ) => Promise<VerdictPromotionOutput>;
};

export type VerdictsPromotePorts = VerdictsValidatePorts & {
    /** The machine pack cache (`verdictCacheDir()`). */
    cacheDir: string;
    /** Stores the pack for these ids ON A DEPLOYMENT and reports its hash. */
    writePack: (verdictIds: readonly string[]) => Promise<{ packHash: string }>;
    runBladeMust: () => Promise<BladeMustResult>;
};

export async function runVerdictsValidate(
    ports: VerdictsValidatePorts
): Promise<string> {
    const output = await ports.engineStep(
        await snapshotVerdictStore(ports.reader, ports.root, "validate")
    );
    return output.text;
}

export type VerdictsPromoteOutcome = {
    text: string;
    /** `false` exactly for a no-op. */
    wrote: boolean;
    /** `null` when nothing was written, so nothing was run. */
    bladePassed: boolean | null;
};

export async function runVerdictsPromote(
    ports: VerdictsPromotePorts
): Promise<VerdictsPromoteOutcome> {
    const output = await ports.engineStep(
        await snapshotVerdictStore(ports.reader, ports.root, "promote")
    );
    if (output.mode !== "promote") {
        throw new Error(
            `the engine step answered "${output.mode}", not a promotion`
        );
    }
    if (output.noop)
        return { text: output.text, wrote: false, bladePassed: null };

    const stored = await ports.writePack(output.lock.verdictIds);
    if (stored.packHash !== output.lock.packHash) {
        throw new Error(
            `the deployment stored pack ${stored.packHash}, but this snapshot encodes to ${output.lock.packHash} — nothing written`
        );
    }
    await loadLockedVerdicts(output.lock, {
        cacheDir: ports.cacheDir,
        store: () => ports.reader,
    });

    writeFileSync(join(ports.root, VERDICT_LOCK_PATH), output.lockText);
    writeFileSync(
        join(ports.root, EVAL_WEIGHTS_PATH),
        output.evalWeightsSource
    );

    const blade = await ports.runBladeMust();
    return {
        text: `${output.text}\n\n${formatBladeMust(blade)}`,
        wrote: true,
        bladePassed: blade.passed,
    };
}

export function formatBladeMust(result: BladeMustResult): string {
    return [
        "== blade `must` tier, on the rewritten weights",
        `  ${result.passed ? "PASSED" : "FAILED"} — ${result.summary}`,
    ].join("\n");
}

/** A blade run's result from its exit status and output. A zero exit with no
 *  vitest summary line is NOT a pass: it ran nothing anyone can name. */
export function parseBladeMust(
    status: number | null,
    output: string
): BladeMustResult {
    // eslint-disable-next-line no-control-regex
    const plain = output.replace(/\x1b\[[0-9;]*m/g, "");
    const summary = plain
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^Tests\s/.test(line))
        .pop();
    return {
        passed: status === 0 && summary !== undefined,
        summary: summary ?? `no vitest summary line (exit ${status})`,
    };
}

// ── Bindings (thin, untested) ────────────────────────────────────────────────

const ENGINE_STEP_SPEC =
    "convex/gre/ai/blade/__tests__/verdict-promotion.spec.ts";

const MAX_BUFFER = 256 * 1024 * 1024;

const tail = (text: string, lines: number) =>
    text.split("\n").slice(-lines).join("\n");

/** The engine step, run through the blade vitest config. A failed run keeps
 *  its directory and names the log. */
export function vitestEngineStep(
    root: string
): VerdictsValidatePorts["engineStep"] {
    return async (input) => {
        const dir = mkdtempSync(join(tmpdir(), "verdict-promotion-"));
        const inPath = join(dir, "in.json");
        const outPath = join(dir, "out.json");
        writeFileSync(inPath, JSON.stringify(input));
        const res = spawnSync(
            "bunx",
            [
                "vitest",
                "run",
                "--config",
                "vitest.blade.config.ts",
                ENGINE_STEP_SPEC,
            ],
            {
                cwd: root,
                encoding: "utf8",
                maxBuffer: MAX_BUFFER,
                env: {
                    ...process.env,
                    [VERDICT_PROMOTION_IN_ENV]: inPath,
                    [VERDICT_PROMOTION_OUT_ENV]: outPath,
                },
            }
        );
        const log = `${res.stdout ?? ""}${res.stderr ?? ""}`;
        if (res.status !== 0 || !existsSync(outPath)) {
            const logPath = join(dir, "engine-step.log");
            writeFileSync(logPath, log);
            throw new Error(
                `the engine step failed (exit ${res.status}) — full log ${logPath}\n${tail(log, 40)}`
            );
        }
        const output = JSON.parse(
            readFileSync(outPath, "utf8")
        ) as VerdictPromotionOutput;
        rmSync(dir, { recursive: true, force: true });
        return output;
    };
}

/** The deployment function that writes a pack (`convex/verdictsPack.ts`). */
export const WRITE_PACK_FUNCTION = "verdictsPack:writePack";

/** `verdictsPack:writePack` on the deployment the environment's deploy key
 *  selects — the same selection `seed:preset` makes for a deployment target,
 *  and for the same reason: a project-scoped key without `--prod` resolves to
 *  the DEV deployment. No `--push`: the function ships with a release, and a
 *  promotion never deploys unreleased code to the deployment holding the
 *  write key. */
export function deploymentPackWriter(
    root: string
): VerdictsPromotePorts["writePack"] {
    return async (verdictIds) => {
        const target = resolveSeedTarget("deployment", process.env, root);
        if (target.error !== undefined) {
            throw new Error(`cannot write the pack: ${target.error}`);
        }
        const res = spawnSync(
            "npx",
            [
                "convex",
                "run",
                ...(target.flags ?? []),
                "--typecheck",
                "disable",
                "--codegen",
                "disable",
                WRITE_PACK_FUNCTION,
                JSON.stringify({ verdictIds }),
            ],
            {
                cwd: target.cwd,
                encoding: "utf8",
                maxBuffer: MAX_BUFFER,
                timeout: 600_000,
            }
        );
        if (res.error) throw new Error(res.error.message);
        if (res.status !== 0) {
            throw new Error(
                convexRunErrorMessage(
                    `${res.stderr ?? ""}${res.stdout ?? ""}`.trim()
                )
            );
        }
        return JSON.parse((res.stdout ?? "").trim()) as { packHash: string };
    };
}

export function bladeMustRunner(
    root: string
): VerdictsPromotePorts["runBladeMust"] {
    return async () => {
        const res = spawnSync("bun", ["run", "test:blade"], {
            cwd: root,
            encoding: "utf8",
            maxBuffer: MAX_BUFFER,
        });
        return parseBladeMust(
            res.status,
            `${res.stdout ?? ""}${res.stderr ?? ""}`
        );
    };
}
