// Decision-telemetry corpus (issue #1893, map #1892). Two roles, mirroring
// `harness.bot.test.ts`:
//
//  1. Always-on SMOKE tests — the root-decision sink records real decisions
//     during a tiny self-play game and a blade scenario slice, the records
//     are internally consistent and deterministic, and the sink is always
//     uninstalled afterwards. This is the regression gate for the
//     instrumentation: `selectRootMove` behaviour itself is untouched (the
//     whole existing bot suite asserts that).
//
//  2. Opt-in RUNNER (gated by the DECISION_CORPUS env var) — collects the
//     full measurement corpus (every blade scenario + self-play games over
//     preset pairings) and prints the summary JSON that
//     `docs/research/decision-telemetry.md` reports. Invoke via:
//       DECISION_CORPUS=1 bunx vitest run src/lib/ai/selfplay/decisionCorpus.bot.test.ts
//     with optional overrides: DECISION_CORPUS_GAMES (per pairing),
//     DECISION_CORPUS_ITER, DECISION_CORPUS_SEED.

import { describe, it, expect } from "vitest";
import {
    getRootDecisionSink,
    summarizeRootDecisions,
    type RootDecisionRecord,
} from "@convex/gre/ai/decisionTelemetry";
import { REWARD_PER_MARGIN_POINT } from "@convex/gre";
import { BLADE_SCENARIOS } from "@convex/gre/ai/blade";
import { collectBladeDecisions } from "@convex/gre/ai/blade/decisionCorpus";
import {
    collectSelfPlayDecisions,
    type SelfPlayCorpusConfig,
} from "./decisionCorpus";

const MECHANISMS = [
    "mean-reward",
    "material-tiebreak",
    "extra-turn-credit",
    "wasteful-attack",
    "block-quality",
    "announcement-variant",
    "self-harm-removal",
    "free-development",
    "hold-trick",
];

/** Structural sanity every record must satisfy, whatever the position. */
function expectWellFormed(r: RootDecisionRecord): void {
    expect(MECHANISMS).toContain(r.mechanism);
    expect(r.poolSize).toBeGreaterThan(0);
    expect(r.exploredSize).toBeGreaterThan(0);
    expect(r.exploredSize).toBeLessThanOrEqual(r.poolSize);
    expect(r.contenderCount).toBeGreaterThan(0);
    expect(r.contenderCount).toBeLessThanOrEqual(r.exploredSize);
    expect(Number.isFinite(r.bestMean)).toBe(true);
    expect(Number.isFinite(r.chosenMean)).toBe(true);
    if (r.gapReward === null) {
        expect(r.exploredSize).toBe(1);
        expect(r.gapMarginPoints).toBeNull();
    } else {
        expect(r.gapReward).toBeGreaterThanOrEqual(0);
        expect(r.gapMarginPoints).toBeCloseTo(
            r.gapReward / REWARD_PER_MARGIN_POINT,
            10
        );
    }
    expect(r.moveKind.length).toBeGreaterThan(0);
    expect(r.phase.length).toBeGreaterThan(0);
}

const SMOKE_CONFIG: SelfPlayCorpusConfig = {
    pairings: [["mono-red-burn", "mono-red-burn"]],
    gamesPerPairing: 1,
    seed: 7,
    budget: { iterations: 8 },
};

describe("decision-telemetry corpus (issue #1893, smoke)", () => {
    it("records well-formed root decisions during a tiny self-play game", () => {
        const { records, gamesPlayed } = collectSelfPlayDecisions(SMOKE_CONFIG);
        expect(gamesPlayed).toBe(1);
        // A full game holds many real decisions; the corpus must see them.
        expect(records.length).toBeGreaterThan(0);
        for (const r of records) expectWellFormed(r);
        // The sink never leaks past the collection (try/finally contract).
        expect(getRootDecisionSink()).toBeNull();
    }, 120_000);

    it("is deterministic: same config, identical record stream", () => {
        const a = collectSelfPlayDecisions(SMOKE_CONFIG).records;
        const b = collectSelfPlayDecisions(SMOKE_CONFIG).records;
        expect(b).toEqual(a);
    }, 240_000);

    it("records decisions from blade scenarios through the production runner", () => {
        const { records } = collectBladeDecisions(BLADE_SCENARIOS.slice(0, 3));
        expect(records.length).toBeGreaterThan(0);
        for (const r of records) expectWellFormed(r);
        expect(getRootDecisionSink()).toBeNull();
    }, 240_000);
});

describe("summarizeRootDecisions (pure aggregation)", () => {
    const record = (over: Partial<RootDecisionRecord>): RootDecisionRecord => ({
        phase: "PRECOMBAT_MAIN",
        moveKind: "pass",
        choiceNode: false,
        poolSize: 4,
        exploredSize: 3,
        contenderCount: 1,
        bestMean: 0.5,
        chosenMean: 0.5,
        gapReward: 0.02,
        gapMarginPoints: 40,
        chosenDeficitReward: 0,
        mechanism: "mean-reward",
        pickIsMeanArgmax: true,
        ...over,
    });

    it("counts mechanisms, phases, kinds, and shares", () => {
        const s = summarizeRootDecisions([
            record({}),
            record({
                mechanism: "free-development",
                moveKind: "play-land",
                contenderCount: 3,
                pickIsMeanArgmax: false,
            }),
            record({
                mechanism: "material-tiebreak",
                phase: "DECLARE_ATTACKERS",
                contenderCount: 2,
            }),
        ]);
        expect(s.total).toBe(3);
        expect(s.byMechanism["mean-reward"]).toBe(1);
        expect(s.byMechanism["free-development"]).toBe(1);
        expect(s.byMechanism["material-tiebreak"]).toBe(1);
        expect(s.byPhase["DECLARE_ATTACKERS"]["material-tiebreak"]).toBe(1);
        expect(s.byMoveKind["play-land"]["free-development"]).toBe(1);
        expect(s.multiContenderShare).toBeCloseTo(2 / 3);
        expect(s.namedRuleShare).toBeCloseTo(1 / 3);
        expect(s.meanArgmaxShare).toBeCloseTo(2 / 3);
    });

    it("buckets the gap histogram on the map's 100-point band edge", () => {
        const s = summarizeRootDecisions([
            record({ gapMarginPoints: 90 }),
            record({ gapMarginPoints: 100 }),
            record({ gapMarginPoints: 101 }),
            record({ gapReward: null, gapMarginPoints: null }),
        ]);
        expect(s.gapHistogram["≤100"]).toBe(2);
        expect(s.gapHistogram["≤150"]).toBe(1);
        expect(s.gapHistogram["single-edge"]).toBe(1);
    });
});

// `process` isn't in the browser-typed src tsconfig; read env off globalThis.
const ENV: Record<string, string | undefined> =
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env ?? {};
const RUN = ENV.DECISION_CORPUS === "1";

describe.runIf(RUN)("decision-telemetry corpus (runner)", () => {
    it("collects the full corpus and writes the summary JSON", async () => {
        const gamesPerPairing = Number(ENV.DECISION_CORPUS_GAMES ?? "12");
        const iterations = Number(ENV.DECISION_CORPUS_ITER ?? "400");
        const seed = Number(ENV.DECISION_CORPUS_SEED ?? "1893");
        // Diverse pairings across archetypes (aggro / control / midrange /
        // artifacts), mirrors included, so no single deck shape dominates the
        // phase / move-kind mix.
        const config: SelfPlayCorpusConfig = {
            pairings: [
                ["mono-red-burn", "mono-red-burn"],
                ["mono-red-burn", "white-weenie"],
                ["white-weenie", "mono-green-stompy"],
                ["mono-black", "channel-fireball"],
                ["robots", "mono-green-stompy"],
                ["channel-fireball", "white-weenie"],
            ],
            gamesPerPairing,
            seed,
            budget: { iterations },
        };
        const selfPlay = collectSelfPlayDecisions(config);
        // Sharding: parallel self-play shards differ only by seed; exactly
        // one shard includes the (deterministic, seed-independent) blade
        // corpus so a merged run never double-counts it.
        const blade =
            ENV.DECISION_CORPUS_BLADE === "0"
                ? { records: [], scenarios: 0 }
                : collectBladeDecisions();
        const out = {
            meta: {
                gamesPerPairing,
                pairings: config.pairings,
                iterations,
                seed,
                selfPlayGames: selfPlay.gamesPlayed,
                selfPlayDecisive: selfPlay.decisive,
                selfPlayReasons: selfPlay.reasons,
                bladeScenarios: blade.scenarios,
                selfPlayDecisions: selfPlay.records.length,
                bladeDecisions: blade.records.length,
            },
            selfPlaySummary: summarizeRootDecisions(selfPlay.records),
            bladeSummary: summarizeRootDecisions(blade.records),
            combinedSummary: summarizeRootDecisions([
                ...selfPlay.records,
                ...blade.records,
            ]),
            // Raw records so parallel shards can be merged and re-summarized
            // exactly (and percentiles computed) offline.
            selfPlayRecords: selfPlay.records,
            bladeRecords: blade.records,
        };
        // Write to the path in DECISION_CORPUS_OUT — vitest's reporter does
        // not reliably surface large console output, so a file is the only
        // dependable channel. The src tsconfig is browser-typed (no node
        // types), hence the non-literal dynamic import: it defeats TS module
        // resolution the same way the globalThis ENV read above does, and
        // resolves fine at runtime (vitest tests run in Node).
        const outPath = ENV.DECISION_CORPUS_OUT;
        if (outPath) {
            const fs = (await import(/* @vite-ignore */ "node" + ":fs")) as {
                writeFileSync: (p: string, d: string) => void;
            };
            fs.writeFileSync(outPath, JSON.stringify(out));
        }
        console.log(
            `decision corpus: ${selfPlay.records.length} self-play + ${blade.records.length} blade records` +
                (outPath
                    ? ` → ${outPath}`
                    : " (set DECISION_CORPUS_OUT to save)")
        );
        expect(selfPlay.records.length).toBeGreaterThan(0);
    }, 10_800_000);
});
