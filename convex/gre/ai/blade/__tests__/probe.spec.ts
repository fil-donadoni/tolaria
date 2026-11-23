// The blade authoring probe — the worker half of `bun run blade:probe`
// (issue #10631).
//
//  1. Always-on: the probe's legs agree with the robustness audit and the
//     blade runner on what they run (seed lists, vectors, the default seed).
//  2. Opt-in WORKER (BLADE_PROBE_DIR=<dir>): reads `config.json`, finds the
//     entry in the real registry (any tier), builds the job list and claims
//     (variant, budget, seed) cells one at a time, writing one row per cell
//     under `rows/`. A red run is DATA here, never a failed test.
//
// It lives HERE for the reason `census.spec.ts` gives: importing the registry
// pulls `lib.dom` into the `scripts` project.
import { describe, expect, it } from "vitest";
import { BLADE_SCENARIOS } from "../registry";
import { DEFAULT_BLADE_SEED, runBladeScenario } from "../runner";
import { ROBUSTNESS_SEEDS, robustnessVectors } from "../robustness";
import {
    PROBE_JITTER_VARIANTS,
    buildProbeJobs,
    planProbeLegs,
    type ProbeConfig,
    type ProbeRow,
} from "../probe";
import { resolveBladeVariant } from "../variant";
import { withRolloutWidth } from "../rolloutWidthRun";
import type { SearchVariant } from "../../searchVariant";
import type { BladeScenario } from "../types";
import { claimPath, loadWorkFs } from "./workClaims.helper";

const ENV: Record<string, string | undefined> =
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env ?? {};

/** A probe variant name → the search variant it runs under: the audit's
 *  jittered vectors by name, else the shared blade resolution. */
function resolveProbeVariant(name: string | null): SearchVariant | null {
    if (name === null) return null;
    const jitter = robustnessVectors().find((v) => v.variant?.name === name);
    if (jitter) return jitter.variant;
    return resolveBladeVariant(name);
}

function findEntry(label: string): BladeScenario {
    const entry = BLADE_SCENARIOS.find((s) => s.label === label);
    if (!entry) throw new Error(`blade:probe: no entry labelled "${label}"`);
    return entry;
}

describe("blade probe — legs", () => {
    it("resolves both jitter names to the audit's own jittered vectors", () => {
        const names = robustnessVectors()
            .map((v) => v.variant?.name)
            .filter((n): n is string => n !== undefined);
        expect(names).toEqual([...PROBE_JITTER_VARIANTS]);
    });

    it("runs the audit's seed list and the runner's default own seed", () => {
        const entry = BLADE_SCENARIOS.find((s) => s.seeds === undefined)!;
        const legs = planProbeLegs(entry, { label: entry.label, seeds: 20 });
        expect(legs.find((l) => l.key === "own")!.seeds).toEqual([
            DEFAULT_BLADE_SEED,
        ]);
        expect(legs.find((l) => l.key === "jitter+")!.seeds).toEqual(
            ROBUSTNESS_SEEDS.slice()
        );
    });

    it("shares the declared-budget base cells instead of running them twice", () => {
        const entry = BLADE_SCENARIOS[0];
        const legs = planProbeLegs(entry, { label: entry.label, seeds: 20 });
        const jobs = buildProbeJobs(legs);
        // ½×, 1×, 2× over 20 seeds + 2 jitter legs over 10 (+ the own seeds
        // the 1× leg does not already hold).
        const own = (entry.seeds ?? [DEFAULT_BLADE_SEED]).filter(
            (s) => !(s >= 0 && s < 20)
        ).length;
        expect(jobs).toHaveLength(60 + 20 + own);
        expect(new Set(jobs.map((j) => j.id)).size).toBe(jobs.length);
    });
});

const DIR = ENV.BLADE_PROBE_DIR;

describe.runIf(DIR !== undefined && DIR !== "")("blade probe (worker)", () => {
    it(
        "claims and runs the probe's cells until none is left",
        { timeout: 0 },
        async () => {
            const fs = await loadWorkFs();
            const config = JSON.parse(
                fs.readFileSync(`${DIR}/config.json`, "utf8")
            ) as ProbeConfig;
            const entry = findEntry(config.label);
            const jobs = buildProbeJobs(planProbeLegs(entry, config));

            fs.mkdirSync(`${DIR}/claims`, { recursive: true });
            fs.mkdirSync(`${DIR}/rows`, { recursive: true });
            if (claimPath(fs, `${DIR}/plan.lock`)) {
                fs.writeFileSync(
                    `${DIR}/plan.json`,
                    JSON.stringify({
                        entry: {
                            label: entry.label,
                            tier: entry.tier,
                            budget: { iterations: entry.budget.iterations },
                            seeds: entry.seeds,
                        },
                        jobs: jobs.map((j) => j.id),
                    })
                );
            }
            let ran = 0;
            for (const job of jobs) {
                if (!claimPath(fs, `${DIR}/claims/${job.id}`)) continue;
                const variant = resolveProbeVariant(job.variant);
                const run = () =>
                    runBladeScenario(
                        {
                            ...entry,
                            seeds: [job.seed],
                            budget: { iterations: job.iterations },
                        },
                        variant
                    );
                const started = Date.now();
                const measured = job.measureWidth
                    ? withRolloutWidth(run)
                    : { value: run(), width: undefined };
                const seed = measured.value.seeds[0];
                const row: ProbeRow = {
                    ...job,
                    ok: seed.ok,
                    move: seed.moveDescription,
                    mechanism: seed.mechanism ?? null,
                    ms: Date.now() - started,
                    ...(measured.width ? { width: measured.width } : {}),
                };
                fs.writeFileSync(
                    `${DIR}/rows/${job.id}.json`,
                    JSON.stringify(row)
                );
                ran++;
            }
            expect(ran).toBeGreaterThanOrEqual(0);
        }
    );
});
