#!/usr/bin/env bun
/**
 * Fit the margin → win-probability calibration on a ladder corpus
 * (issue #1929, map #1892 attack-order step 3).
 *
 *   bun scripts/fit-reward-mapping.ts ladder-runs/<run>.jsonl [<more>.jsonl…]
 *
 * Reads the per-turn S0-perspective margin samples the ladder records
 * (scripts/lib/ladder/plan.ts `marginSamples`), fits the one-parameter
 * logistic P(win) = σ(k·margin) (scripts/lib/ladder/fit.ts — deterministic
 * Newton MLE on the symmetrically augmented corpus), prints the calibration
 * curve (empirical vs fitted per margin band), and emits the constant to land
 * in convex/gre/ai/evalWeights.ts (DEFAULT_EVAL_WEIGHTS.calibratedRewardK).
 * Pure read-only reporting — the fitted constant is applied by hand as CODE,
 * never as a data-file dependency (ticket #1929 §2).
 */
import { readFileSync } from "node:fs";

import {
    calibrationTable,
    extractCalibrationSamples,
    fitLogisticSlope,
    type CalibrationSample,
} from "./lib/ladder/fit";
import { parseRunFile } from "./lib/ladder/plan";

const files = process.argv.slice(2);
if (files.length === 0) {
    console.error(
        "usage: bun scripts/fit-reward-mapping.ts <run.jsonl> [<more>.jsonl…]"
    );
    process.exit(2);
}

const samples: CalibrationSample[] = [];
let games = 0;
for (const f of files) {
    const { header, records } = parseRunFile(
        readFileSync(f, "utf8").split("\n")
    );
    const s = extractCalibrationSamples(header, records);
    const used = records.filter(
        (r) =>
            r.candidateWon !== null &&
            (header.variant !== null || r.orientation === 0)
    ).length;
    games += used;
    samples.push(...s);
    console.log(
        `${f}: ${used} labelled games (variant=${header.variant ?? "null"}), ${s.length} samples`
    );
}

const fit = fitLogisticSlope(samples);
console.log(
    `\ncorpus: ${games} games, ${samples.length} samples (${fit.n} after symmetric augmentation)`
);
console.log(
    `fit:    k = ${fit.k.toExponential(6)}  (${fit.steps} Newton steps, mean logloss ${fit.logLoss.toFixed(4)})`
);

const EDGES = [
    -Infinity,
    -1600,
    -800,
    -400,
    -200,
    -100,
    -50,
    0,
    50,
    100,
    200,
    400,
    800,
    1600,
    Infinity,
];
console.log("\ncalibration curve (empirical vs fitted, S0 win rate):");
console.log("   margin band       n   empirical  fitted");
for (const b of calibrationTable(samples, fit.k, EDGES)) {
    const lo = b.lo === -Infinity ? "-inf" : String(b.lo);
    const hi = b.hi === Infinity ? "+inf" : String(b.hi);
    const band = `[${lo}, ${hi})`.padEnd(16);
    if (b.n === 0) {
        console.log(`   ${band} ${String(0).padStart(5)}       —       —`);
        continue;
    }
    console.log(
        `   ${band} ${String(b.n).padStart(5)}     ${b.empirical.toFixed(3)}   ${b.fitted.toFixed(3)}`
    );
}

// Model-shape diagnostic: refit on early / mid / late samples separately. One
// GLOBAL constant is only the right model if the slope is stable across game
// stages — a k that climbs with the turn count means the same margin predicts
// the outcome far better late than early, which a single logistic cannot
// express (the isotonic / stage-aware signal, research §value scaling).
console.log("\nslope stability across game stages (model-shape check):");
const STAGES: [string, (t: number) => boolean][] = [
    ["turns 1–5   ", (t) => t <= 5],
    ["turns 6–12  ", (t) => t > 5 && t <= 12],
    ["turns 13+   ", (t) => t > 12],
];
for (const [label, pred] of STAGES) {
    const sub = samples.filter((s) => pred(s.turn));
    if (sub.length === 0) {
        console.log(`   ${label} (no samples)`);
        continue;
    }
    const f = fitLogisticSlope(sub);
    console.log(
        `   ${label} n=${String(sub.length).padStart(5)}  k=${f.k.toExponential(3)}` +
            `  75% at ${(Math.log(3) / f.k).toFixed(0)} margin points`
    );
}

// What the constant means for the map's evidence-1 arithmetic (#1893): the
// open-band reward slope at margin 0 becomes (1 − 2·TERMINAL_BAND)·k/4, so the
// OUTCOME_EPS tie window converts back to margin points as EPS / that slope.
const TERMINAL_BAND = 0.25;
const OUTCOME_EPS = 0.05;
const slope0 = ((1 - 2 * TERMINAL_BAND) * fit.k) / 4;
console.log(
    `\nconstant to land in convex/gre/ai/evalWeights.ts (DEFAULT_EVAL_WEIGHTS):`
);
console.log(`   calibratedRewardK: ${fit.k.toExponential(6)},`);
console.log(
    `\n   margin at 75% win prob: ${(Math.log(3) / fit.k).toFixed(1)} points` +
        `\n   margin at 90% win prob: ${(Math.log(9) / fit.k).toFixed(1)} points` +
        `\n   indifference band at margin 0 (OUTCOME_EPS ${OUTCOME_EPS}): ` +
        `${(OUTCOME_EPS / slope0).toFixed(1)} margin points (linear-clip mapping: 100)`
);
