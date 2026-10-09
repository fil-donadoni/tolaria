#!/usr/bin/env bun
/**
 * Prune the aiEffects guard baseline `data/ai-effects-allowlist.json`
 * (issue #3017).
 *
 * WHAT THIS IS FOR. The guard (`convex/cards/__tests__/aiEffectsGuard.bot.test.ts`,
 * issue #1431) reds when a baseline row's card or ability stops being AI-blind
 * - it graduated onto a real `effects[]` script, an `aiEffects` shadow, or an
 * `aiValue` override. Before this script that red was cleared by hand-deleting
 * a block from a 3.3k-line test file, which serialised every migration PR
 * through one file. Run this instead, and commit the pruned artifact.
 *
 *   bun run ai:allowlist            # prune graduated rows and write
 *   bun run ai:allowlist --check    # report only, write nothing (exit 1 on drift)
 *
 * WHAT IT REFUSES TO DO. It is PRUNE-ONLY: it deletes rows and never adds,
 * rewrites or reorders a surviving row's fields (see the rationale in
 * `scripts/lib/ai-effects-baseline.ts`). Two conditions make it exit 1 without
 * writing anything:
 *
 *   - GROWTH. A live AI-blind site with no baseline row. A NEW resolve() card
 *     or ability ships an `aiEffects` shadow script or an `aiValue` override -
 *     it does not buy a baseline slot, which is the entire point of issue
 *     #1431's guard. Fix the card, not the baseline.
 *   - NAME DRIFT. A row's card id now carries a different name, i.e. the
 *     catalogue was rebuilt or renumbered under the row. Auto-rewriting the
 *     name would erase exactly the signal the assertion exists for.
 *
 * NEVER do this (banned-recipe: cited-to-forbid):
 * `printf '[]\n' > data/ai-effects-allowlist.json`. An empty baseline does not
 * make the guard pass - it makes every one of the 497 live sites read as
 * GROWTH, which is the loudest possible red. Emptying it honestly is issue
 * #1436's backfill, one card at a time.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getAllCards } from "../convex/cards/index";
import {
    AI_EFFECTS_BASELINE_PATH,
    AI_EFFECTS_INERT_BASELINE_PATH,
    describeInert,
    describeOffender,
    pruneBaseline,
    pruneInertBaseline,
    serializeBaseline,
    serializeInertBaseline,
    type AiEffectsBaselineRow,
    type AiEffectsInertRow,
} from "./lib/ai-effects-baseline";

const checkOnly = process.argv.includes("--check");
const path = resolve(AI_EFFECTS_BASELINE_PATH);

let baseline: AiEffectsBaselineRow[];
try {
    baseline = JSON.parse(readFileSync(path, "utf8")) as AiEffectsBaselineRow[];
} catch (err) {
    console.error(
        `x ai:allowlist: cannot read ${AI_EFFECTS_BASELINE_PATH} - ${String(err)}`
    );
    process.exit(1);
}

const { grown, graduated, drifted, pruned } = pruneBaseline(
    baseline,
    getAllCards()
);

if (grown.length > 0) {
    console.error(
        `x ai:allowlist: ${grown.length} AI-blind site(s) have no baseline row. ` +
            `A NEW resolve()/resolveSteps card or ability must ship an aiEffects ` +
            `shadow script (walked by the same OP_VALUERS a real effects[] script ` +
            `uses) or an aiValue override - the baseline is prune-only and will ` +
            `not take a new row (issue #1431):`
    );
    for (const site of grown) console.error(`    ${describeOffender(site)}`);
}

if (drifted.length > 0) {
    console.error(
        `x ai:allowlist: ${drifted.length} baseline row(s) name a card id that now ` +
            `carries a different name - the catalogue was rebuilt or renumbered ` +
            `under them. Adjudicate by hand; the prune never rewrites a name:`
    );
    for (const { row, liveName } of drifted) {
        console.error(
            `    ${describeOffender(row)} is now "${liveName}" in the catalogue`
        );
    }
}

if (grown.length > 0 || drifted.length > 0) process.exit(1);

// Inert shadows (issue #5150): graduated is not the same claim as "the Bot
// sees it". Census first, then the prune-only baseline of inert sites.
const inertPath = resolve(AI_EFFECTS_INERT_BASELINE_PATH);
let inertBaseline: AiEffectsInertRow[];
try {
    inertBaseline = JSON.parse(
        readFileSync(inertPath, "utf8")
    ) as AiEffectsInertRow[];
} catch (err) {
    console.error(
        `x ai:allowlist: cannot read ${AI_EFFECTS_INERT_BASELINE_PATH} - ${String(err)}`
    );
    process.exit(1);
}
const inert = pruneInertBaseline(inertBaseline, getAllCards());

console.log(
    `${inert.live.length} inert shadow site(s) - the shadow leaves the card's latent value at the base + MV floor (script / floor):`
);
for (const site of inert.live) console.log(`    ${describeInert(site)}`);

if (inert.grown.length > 0) {
    console.error(
        `x ai:allowlist: ${inert.grown.length} inert shadow site(s) have no baseline row. ` +
            `A new aiEffects shadow must lift its card above the base + MV floor; the ` +
            `inert baseline is prune-only and will not take a new row (issue #5150):`
    );
    for (const site of inert.grown) console.error(`    ${describeInert(site)}`);
    process.exit(1);
}
const inertStale = inert.lifted.length > 0;
if (inertStale) {
    console.log(
        `${inert.lifted.length} row(s) no longer inert - the shadow moves the card now:`
    );
    for (const row of inert.lifted) console.log(`    ${describeInert(row)}`);
}

if (graduated.length === 0 && !inertStale) {
    console.log(
        `= ai:allowlist: in sync, ${pruned.length} AI-blind site(s) baselined (nothing graduated), ${inert.pruned.length} inert`
    );
    process.exit(0);
}
if (inertStale && !checkOnly) {
    writeFileSync(inertPath, serializeInertBaseline(inert.pruned));
    console.log(
        `= ai:allowlist: pruned ${inert.lifted.length} inert row(s) -> ${AI_EFFECTS_INERT_BASELINE_PATH}`
    );
}
if (graduated.length === 0) {
    if (checkOnly) {
        console.error(
            `x ai:allowlist: ${AI_EFFECTS_INERT_BASELINE_PATH} is stale by ${inert.lifted.length} row(s). ` +
                `Prune it with: bun run ai:allowlist`
        );
        process.exit(1);
    }
    process.exit(0);
}

console.log(
    `${graduated.length} site(s) graduated - they carry effects[], aiEffects or aiValue now:`
);
for (const row of graduated) console.log(`    ${describeOffender(row)}`);

if (checkOnly) {
    console.error(
        `x ai:allowlist: ${AI_EFFECTS_BASELINE_PATH} is stale by ${graduated.length} row(s). ` +
            `Prune it with: bun run ai:allowlist`
    );
    process.exit(1);
}

writeFileSync(path, serializeBaseline(pruned));
console.log(
    `= ai:allowlist: pruned ${graduated.length} row(s), ${pruned.length} remaining -> ${AI_EFFECTS_BASELINE_PATH}`
);
