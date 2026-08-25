// Decision-telemetry corpus runner (issue #1893, map #1892).
//
// Produces the record corpus the map's evidence-1 verdict is measured on: it
// installs the root-decision sink (`convex/gre/ai/decisionTelemetry.ts`),
// drives the REAL search over two deterministic sources, and returns the raw
// records for `summarizeRootDecisions` / the findings doc
// (`docs/research/decision-telemetry.md`):
//
//   * bot-vs-bot self-play over preset decks — full games through the
//     production `runHeadlessGame`, seeded per game (this module);
//   * the blade registry — every scenario run through the production
//     `runBladeScenario` (`convex/gre/ai/blade/decisionCorpus.ts`; see the
//     NOTE below on why it cannot live here).
//
// A measurement, not a fix: nothing here changes any search behaviour, and
// the sink is always uninstalled (try/finally) so no record-building cost
// leaks into later searches in the same process.

import {
    setRootDecisionSink,
    type RootDecisionRecord,
} from "@convex/gre/ai/decisionTelemetry";
import { createInitialGameState, type SearchBudget } from "@convex/gre";
import {
    LADDER_VARIANTS,
    type SearchVariant,
} from "@convex/gre/ai/searchVariant";
import { presetToPlayerInput } from "./decks";
import { runHeadlessGame, type GameEndReason } from "./playGame";

// NOTE: the blade half of the corpus (`collectBladeDecisions`) lives in
// `convex/gre/ai/blade/decisionCorpus.ts`, not here: the blade runner's setup
// chain reaches `convex/auth` (server-only), and this module is client code
// under the bundle-purity guard (ADR 0074). Only the bot test — excluded from
// that scan — may import it.

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

/** Resolve the optional search-variant leg of a corpus run (issue #1929).
 *
 *  An unknown name THROWS rather than falling back to "no variant", and that
 *  is the whole point of the helper existing. A typo'd variant that silently
 *  resolved to `undefined` would collect a leg identical to the baseline and
 *  report it under the variant's name — the comparison would then read "the
 *  variant changes nothing", which is indistinguishable from a real null
 *  result and wrong. That is exactly the shape #2747 fixed on the ladder side
 *  (a worker silently dropping `marginSamples`, so an entire decision-tier run
 *  wrote a corpus with the calibration data missing and no error anywhere):
 *  the failure of a MEASUREMENT to measure has to be loud, because nothing
 *  downstream can tell it apart from a finding. */
export function resolveCorpusVariant(
    name: string | undefined
): SearchVariant | null {
    if (!name) return null;
    const variant = LADDER_VARIANTS[name];
    if (!variant)
        throw new Error(
            `unknown DECISION_CORPUS_VARIANT "${name}" — known: ${Object.keys(LADDER_VARIANTS).join(", ")}`
        );
    return variant;
}
