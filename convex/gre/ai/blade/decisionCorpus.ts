// Blade-side decision-telemetry collection (issue #1893, map #1892).
//
// Lives NEXT TO the blade runner rather than in the src-side corpus module
// (`src/lib/ai/selfplay/decisionCorpus.ts`) because it runs the whole harness
// over the whole registry: 6.6k lines of scenario data plus `runBladeScenario`,
// which no browser caller wants in its bundle. Only the bot TEST file imports
// this. (Until issue #3479 the reason was harder — the setup chain reached
// `convex/game` and so `convex/auth`, which the client-bundle-purity guard,
// ADR 0074, rightly rejects. That is no longer true of the BUILDER; it is still
// true that nothing in `src/` should pull the harness.)

import {
    setRootDecisionSink,
    type RootDecisionRecord,
} from "../decisionTelemetry";
import { BLADE_SCENARIOS } from "./registry";
import { runBladeScenario } from "./runner";
import type { BladeScenario } from "./types";

/** Collect one record per root decision made while running `scenarios`
 *  through the production blade runner. Deterministic: the blade runner's
 *  own fixed-deck / fixed-seed contract carries over unchanged. The sink is
 *  always uninstalled afterwards (try/finally). */
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
