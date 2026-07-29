// Blade-side decision-telemetry collection (issue #1893, map #1892).
//
// Lives NEXT TO the blade runner rather than in the src-side corpus module
// (`src/lib/ai/selfplay/decisionCorpus.ts`) because the runner's setup chain
// (`applyBladeSetup` → `convex/game` → `convex/auth`) is server-only: a
// non-test src module importing it puts `convex/auth` in the client bundle,
// which the client-bundle-purity guard (ADR 0074) rightly rejects. Only the
// bot TEST file (excluded from that scan — tests run in node) imports this.

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
