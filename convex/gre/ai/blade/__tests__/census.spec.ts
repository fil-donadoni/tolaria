// The blade flip census — the worker half of `bun run blade:census`.
//
//  1. Always-on: the census's job list agrees with the blade runner on the
//     seeds it runs (the default seed is a copy, `census.ts` cannot import
//     the runner).
//  2. Opt-in WORKER (BLADE_CENSUS_DIR=<dir>): reads the arm's `config.json`
//     from the directory, builds the job list from the real registry, and
//     claims (entry, seed) jobs one at a time — a claim is an atomic `mkdir`
//     under `claims/`, so any number of workers share one list with no
//     coordinator — writing one row per job under `rows/`. A red verdict is
//     DATA here, never a failed test: the census reports it.
//
// It lives HERE for the reason `audit-census.spec.ts` gives: importing the
// registry pulls `convex/game.ts` and with it `lib.dom`, which reds an
// unrelated script in the `scripts` project.
import { describe, expect, it } from "vitest";
import { BLADE_SCENARIOS } from "../registry";
import { DEFAULT_BLADE_SEED, runBladeScenario } from "../runner";
import {
    DEFAULT_CENSUS_SEED,
    buildCensusJobs,
    selectCensusEntries,
    sliceCensusJobs,
    type CensusConfig,
    type CensusRow,
} from "../census";
import { resolveBladeVariant } from "../variant";

const ENV: Record<string, string | undefined> =
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env ?? {};

describe("blade census — job list", () => {
    it("runs the blade runner's default seed for an entry that declares none", () => {
        expect(DEFAULT_CENSUS_SEED).toBe(DEFAULT_BLADE_SEED);
    });

    it("covers every (entry, seed) pair of the must tier exactly once", () => {
        const config: CensusConfig = { tier: "must" };
        const entries = selectCensusEntries(BLADE_SCENARIOS, config);
        const jobs = buildCensusJobs(entries, config);
        const expected = entries.reduce(
            (n, e) => n + (e.seeds?.length ?? 1),
            0
        );
        expect(jobs).toHaveLength(expected);
        expect(new Set(jobs.map((j) => `${j.label}|${j.seed}`)).size).toBe(
            expected
        );
    });
});

type Fs = {
    readFileSync: (p: string, enc: "utf8") => string;
    writeFileSync: (p: string, d: string) => void;
    mkdirSync: (p: string, o?: { recursive?: boolean }) => void;
    existsSync: (p: string) => boolean;
};

const DIR = ENV.BLADE_CENSUS_DIR;

/** A key safe as a directory name for an entry label. */
function labelKey(label: string): string {
    let h = 0;
    for (let i = 0; i < label.length; i++) {
        h = (Math.imul(h, 31) + label.charCodeAt(i)) | 0;
    }
    return `${(h >>> 0).toString(16)}-${label.length}`;
}

/** `mkdir` as an atomic claim: true for the one caller that created it. */
function claim(fs: Fs, path: string): boolean {
    try {
        fs.mkdirSync(path);
        return true;
    } catch (e) {
        if ((e as { code?: string }).code === "EEXIST") return false;
        throw e;
    }
}

describe.runIf(DIR !== undefined && DIR !== "")("blade census (worker)", () => {
    // A worker runs for as long as there are jobs to claim; its verdicts depend
    // on iterations and seeds only (the `NO_WALL_CLOCK_CEILING` rule of the
    // shard runner).
    it(
        "claims and runs (entry, seed) jobs until none is left",
        { timeout: 0 },
        async () => {
            const fs = (await import(/* @vite-ignore */ "node" + ":fs")) as Fs;
            const config = JSON.parse(
                fs.readFileSync(`${DIR}/config.json`, "utf8")
            ) as CensusConfig;
            const variant = resolveBladeVariant(config.variant);
            const entries = selectCensusEntries(BLADE_SCENARIOS, config);
            const byLabel = new Map(entries.map((e) => [e.label, e]));
            const jobs = sliceCensusJobs(
                buildCensusJobs(entries, config),
                config.slice
            );

            fs.mkdirSync(`${DIR}/claims`, { recursive: true });
            fs.mkdirSync(`${DIR}/rows`, { recursive: true });
            fs.mkdirSync(`${DIR}/red`, { recursive: true });
            // The plan, so the orchestrator can prove every job wrote a row.
            if (claim(fs, `${DIR}/plan.lock`)) {
                fs.writeFileSync(
                    `${DIR}/plan.json`,
                    JSON.stringify({ jobs: jobs.map((j) => j.id) })
                );
            }

            let ran = 0;
            for (const job of jobs) {
                if (!claim(fs, `${DIR}/claims/${job.id}`)) continue;
                const redMarker = `${DIR}/red/${labelKey(job.label)}`;
                let row: CensusRow;
                if (config.failFast && fs.existsSync(redMarker)) {
                    row = {
                        ...job,
                        ok: true,
                        skipped: true,
                        move: "",
                        reason: "",
                        mechanism: null,
                        ms: 0,
                    };
                } else {
                    const scenario = byLabel.get(job.label)!;
                    const started = Date.now();
                    const result = runBladeScenario(
                        {
                            ...scenario,
                            seeds: [job.seed],
                            budget: { iterations: job.iterations },
                        },
                        variant
                    );
                    const seed = result.seeds[0];
                    row = {
                        ...job,
                        ok: seed.ok,
                        move: seed.moveDescription,
                        reason: seed.reason,
                        mechanism: seed.mechanism ?? null,
                        ms: Date.now() - started,
                    };
                    if (!seed.ok) claim(fs, redMarker);
                }
                fs.writeFileSync(
                    `${DIR}/rows/${job.id}.json`,
                    JSON.stringify(row)
                );
                ran++;
            }
            // A worker that found the list already drained ran nothing: legal.
            expect(ran).toBeGreaterThanOrEqual(0);
        }
    );
});
