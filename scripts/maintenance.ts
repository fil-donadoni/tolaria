#!/usr/bin/env bun
/**
 * The maintenance reports, by hand (issue #5458).
 *
 *   bun run maintenance                     # every MAINTENANCE_SCRIPTS entry
 *   bun run maintenance check:convex-heap   # one of them
 *
 * Runs each diagnostic-only `check:*` script that no gate composes
 * (`MAINTENANCE_SCRIPTS` in `lib/health-step.ts`) in the foreground, its
 * report straight to the terminal, under the heavy gate like every CPU-bound
 * step: a `land` queued behind it waits, a health run queues it. Exit status
 * is the worst child's — a report over budget is still a report, and this
 * script never writes a verdict, a marker or a ledger.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { MAINTENANCE_SCRIPTS } from "./lib/health-step";

const GATE = resolve(__dirname, "gate.ts");

function main(): number {
    const asked = process.argv.slice(2);
    const known = Object.keys(MAINTENANCE_SCRIPTS);
    const unknown = asked.filter((name) => !known.includes(name));
    if (unknown.length > 0) {
        console.error(
            `maintenance: not a maintenance script: ${unknown.join(", ")} — known: ${known.join(", ")}`
        );
        return 2;
    }
    const names = asked.length > 0 ? asked : known;
    let code = 0;
    for (const name of names) {
        const { measuredCostS, why } = MAINTENANCE_SCRIPTS[name]!;
        console.log(
            `maintenance: ${name} — ${why} (measured ~${Math.round(measuredCostS / 60)} min)`
        );
        const r = spawnSync("bun", [GATE, "heavy", `bun run ${name}`], {
            stdio: "inherit",
        });
        const status = r.status ?? 1;
        console.log(`maintenance: ${name} — exit ${status}`);
        code = Math.max(code, status);
    }
    return code;
}

process.exit(main());
