// Leak detector for the `bot-node` project (issue #6151), which runs
// `isolate: false`: one module registry — and one `globalThis`, one
// `process.env` — per worker, shared by every file the worker runs.
//
// The deep-frozen catalogue (`vitest.setup.node.ts`) stops a test MUTATING
// shared data; it cannot stop a test INSTALLING a process-wide setting and
// forgetting to take it down. Each setting below is installed by some bot
// test and restored by hand (try/finally, `afterEach`). A dropped restore is
// green in the leaking file and wrong in whichever file the scheduler runs
// next — an order-dependent intermittent red in health, far from its cause.
//
// So after every file, each setting is asserted back at its default. A leak
// reds HERE, at the leaking file, on every run, deterministically — and the
// detector puts the default back before throwing, so the red stays with the
// file that caused it instead of cascading into its neighbours.
//
// The settings, and their defaults:
//   - the search variant (`setSearchVariant`)       → null
//   - the root decision sink (`setRootDecisionSink`) → null
//   - the decision trace store (traces, escalations, decisions) → empty
//   - `globalThis.Worker`  → what it was when the file started
//   - `process.env`        → what it was when the file started
//
// Vitest re-runs this file before every test file, so the two snapshots are
// per file; the imported modules are the worker's shared instances, the
// very ones the tests write to.
import { afterAll } from "vitest";
import {
    getSearchVariant,
    setSearchVariant,
} from "./convex/gre/ai/searchVariant";
import {
    getRootDecisionSink,
    setRootDecisionSink,
} from "./convex/gre/ai/decisionTelemetry";
import {
    clearAiDecisions,
    clearAiEscalations,
    clearAiTraces,
    getAiDecisions,
    getAiEscalations,
    getAiTraces,
} from "./src/lib/ai/trace-store";

const workerAtStart = (globalThis as { Worker?: unknown }).Worker;
const envAtStart = { ...process.env };

/** The keys whose value differs between two env snapshots, each named once. */
function envDrift(
    before: Record<string, string | undefined>,
    after: Record<string, string | undefined>
): string[] {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].filter((k) => before[k] !== after[k]).sort();
}

afterAll(() => {
    const leaks: string[] = [];
    if (getSearchVariant() !== null) {
        leaks.push("the search variant is still set (setSearchVariant(null))");
        setSearchVariant(null);
    }
    if (getRootDecisionSink() !== null) {
        leaks.push(
            "the root decision sink is still installed (setRootDecisionSink(null))"
        );
        setRootDecisionSink(null);
    }
    const rings = {
        traces: getAiTraces().length,
        escalations: getAiEscalations().length,
        decisions: getAiDecisions().length,
    };
    const filled = Object.entries(rings).filter(([, n]) => n > 0);
    if (filled.length > 0) {
        leaks.push(
            `the decision trace store is not empty (${filled
                .map(([ring, n]) => `${ring}: ${n}`)
                .join(", ")}) — clear it in afterEach`
        );
        clearAiTraces();
        clearAiEscalations();
        clearAiDecisions();
    }
    const g = globalThis as { Worker?: unknown };
    if (g.Worker !== workerAtStart) {
        leaks.push("globalThis.Worker was replaced and not restored");
        if (workerAtStart === undefined) delete g.Worker;
        else g.Worker = workerAtStart;
    }
    const drift = envDrift(envAtStart, process.env);
    if (drift.length > 0) {
        leaks.push(`process.env changed: ${drift.join(", ")}`);
        for (const key of Object.keys(process.env)) {
            if (!(key in envAtStart)) delete process.env[key];
        }
        Object.assign(process.env, envAtStart);
    }
    if (leaks.length > 0) {
        throw new Error(
            `This file left process-wide state behind in a shared bot-node ` +
                `worker (isolate: false) — the next file the worker runs ` +
                `would inherit it. Restore it where it was set:\n  - ` +
                leaks.join("\n  - ")
        );
    }
});
