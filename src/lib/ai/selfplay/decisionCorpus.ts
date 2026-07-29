// Decision-telemetry corpus runner (issue #1893, map #1892).
//
// Produces the record corpus the map's evidence-1 verdict is measured on: it
// installs the root-decision sink (`convex/gre/ai/decisionTelemetry.ts`),
// drives the REAL search over two deterministic sources, and returns the raw
// records for `summarizeRootDecisions` / the findings doc
// (`docs/research/decision-telemetry.md`):
//
//   * the blade registry — every scenario run through the production
//     `runBladeScenario` (fixed synthetic decks, fixed seeds);
//   * bot-vs-bot self-play over preset decks — full games through the
//     production `runHeadlessGame`, seeded per game.
//
// A measurement, not a fix: nothing here changes any search behaviour, and
// the sink is always uninstalled (try/finally) so no record-building cost
// leaks into later searches in the same process.

import {
    setRootDecisionSink,
    type RootDecisionRecord,
} from "@convex/gre/ai/decisionTelemetry";
import {
    BLADE_SCENARIOS,
    runBladeScenario,
    type BladeScenario,
} from "@convex/gre/ai/blade";
import { createInitialGameState, type SearchBudget } from "@convex/gre";
import { presetToPlayerInput } from "./decks";
import { runHeadlessGame, type GameEndReason } from "./playGame";

/** Collect one record per root decision made while running `scenarios`
 *  through the production blade runner. Deterministic: the blade runner's
 *  own fixed-deck / fixed-seed contract carries over unchanged. */
export function collectBladeDecisions(
    scenarios: BladeScenario[] = BLADE_SCENARIOS
): { records: RootDecisionRecord[]; scenarios: number } {
    const records: RootDecisionRecord[] = [];
    setRootDecisionSink((r) => records.push(r));
    try {
        for (const scenario of scenarios) {
            runBladeScenario(scenario);
        }
    } finally {
        setRootDecisionSink(null);
    }
    return { records, scenarios: scenarios.length };
}

export type SelfPlayCorpusConfig = {
    /** Preset-deck pairings to play (e.g. `[["mono-red-burn", "white-weenie"]]`). */
    pairings: [string, string][];
    gamesPerPairing: number;
    /** Base seed; pairing p game i uses `seed + p * gamesPerPairing + i`. */
    seed: number;
    /** MUST be iterations-only for a reproducible corpus (never `timeMs`). */
    budget: SearchBudget;
};

export type SelfPlayCorpusReport = {
    records: RootDecisionRecord[];
    gamesPlayed: number;
    /** Games ending in a real MTG result — the corpus health check. */
    decisive: number;
    reasons: Partial<Record<GameEndReason, number>>;
};

/** Collect one record per root decision across full bot-vs-bot games. The
 *  on-the-play seat alternates per game (as `runMatch` does) so the corpus
 *  is not biased toward first-player decision shapes. */
export function collectSelfPlayDecisions(
    config: SelfPlayCorpusConfig
): SelfPlayCorpusReport {
    const records: RootDecisionRecord[] = [];
    const reasons: Partial<Record<GameEndReason, number>> = {};
    let decisive = 0;
    let gamesPlayed = 0;

    setRootDecisionSink((r) => records.push(r));
    try {
        for (let p = 0; p < config.pairings.length; p++) {
            const [deckA, deckB] = config.pairings[p];
            for (let i = 0; i < config.gamesPerPairing; i++) {
                const seed = config.seed + p * config.gamesPerPairing + i;
                const aOnPlay = i % 2 === 0;
                const aInput = presetToPlayerInput(deckA, aOnPlay ? 0 : 1, "A");
                const bInput = presetToPlayerInput(deckB, aOnPlay ? 1 : 0, "B");
                const players = aOnPlay ? [aInput, bInput] : [bInput, aInput];

                const state = createInitialGameState(players, seed);
                const result = runHeadlessGame(
                    state,
                    { id: "A", budget: config.budget },
                    { id: "B", budget: config.budget },
                    seed
                );
                gamesPlayed++;
                reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
                if (result.winnerId !== null) decisive++;
            }
        }
    } finally {
        setRootDecisionSink(null);
    }
    return { records, gamesPlayed, decisive, reasons };
}
