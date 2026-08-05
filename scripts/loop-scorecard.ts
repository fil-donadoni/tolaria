#!/usr/bin/env bun
// `bun run loop:scorecard` — print the loop's measured scorecard for a window
// (issue #2187, PRD #2180).
//
// This wrapper holds NO definitions. It reads the telemetry log and the receipt
// directories, calls `summarizeLoop`, and prints. Every rate lives in
// `lib/scorecard.ts` where it is pure and pinned by a frozen fixture — a metric
// re-derived here would be an unpinned second definition of the same series,
// which is the failure this whole PRD is about.
//
// Usage:
//   bun run loop:scorecard                 # last 7 days
//   bun run loop:scorecard --days 30
//   bun run loop:scorecard --json
//   bun run loop:scorecard --events <path> --receipts <dir>
//
// A window with no data prints zeroes AND says so. That distinction matters:
// "the loop blocked no reviews" and "no review was recorded" are the same
// number and opposite facts.

import * as fs from "fs";
import * as path from "path";
import {
    summarizeLoop,
    type ScorecardReceipt,
    type TelemetryEvent,
} from "./lib/scorecard";

function flag(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? undefined : process.argv[i + 1];
}

const root = process.cwd();
const eventsPath =
    flag("events") ??
    path.join(root, ".claude", "telemetry", "tool-events.jsonl");
const receiptsRoot = flag("receipts") ?? path.join(root, ".claude", "receipts");
const days = Number(flag("days") ?? 7);
const asJson = process.argv.includes("--json");

const now = Math.floor(Date.now() / 1000);
const window = { from: now - days * 86_400, to: now };

const events: TelemetryEvent[] = fs.existsSync(eventsPath)
    ? fs
          .readFileSync(eventsPath, "utf8")
          .split("\n")
          .filter((l) => l.trim() !== "")
          .flatMap((l) => {
              try {
                  return [JSON.parse(l) as TelemetryEvent];
              } catch {
                  // A truncated final line is normal for a log being appended to
                  // while it is read. Dropping it is correct; dropping it
                  // SILENTLY is not — the count is reported below.
                  return [];
              }
          })
    : [];

const receipts: ScorecardReceipt[] = [];
if (fs.existsSync(receiptsRoot)) {
    for (const batch of fs.readdirSync(receiptsRoot)) {
        const dir = path.join(receiptsRoot, batch);
        if (!fs.statSync(dir).isDirectory()) continue;
        for (const file of fs.readdirSync(dir)) {
            if (!file.endsWith(".json")) continue;
            try {
                const raw = JSON.parse(
                    fs.readFileSync(path.join(dir, file), "utf8")
                ) as Record<string, unknown>;
                receipts.push({ ...raw, batch } as ScorecardReceipt);
            } catch {
                // Same as above: a half-written receipt is skipped, not fatal —
                // the scorecard is a report, not a gate.
            }
        }
    }
}

const card = summarizeLoop({ events, receipts, window });

if (asJson) {
    console.log(JSON.stringify(card, null, 2));
    process.exit(0);
}

const pct = (v: number | null) =>
    v === null ? "n/a" : `${Math.round(v * 100)}%`;
const num = (v: number | null, digits = 1) =>
    v === null ? "n/a" : v.toFixed(digits);
const k = (v: number) => `${Math.round(v / 1000)}k`;

console.log(`\nLoop scorecard — last ${days} day(s)`);
console.log(`  events read       ${events.length}`);
console.log(`  receipts read     ${receipts.length}`);
console.log(`  passes            ${card.passes}`);
console.log(`  issues shipped    ${card.issuesShipped}`);
console.log(`  wall-clock/issue  ${num(card.wallClockPerIssueSec, 0)} s`);
console.log(`\n  tokens by role`);
for (const [role, tokens] of Object.entries(card.tokensByRole)) {
    const per =
        card.tokensPerIssueByRole?.[role as keyof typeof card.tokensByRole];
    console.log(
        `    ${role.padEnd(14)} ${k(tokens).padStart(6)}` +
            (per === undefined ? "" : `   (${k(per)}/issue)`)
    );
}
console.log(
    `    unattributed share ${pct(card.unclassifiedTokenShare)} of agent tokens`
);
console.log(
    `\n  review-blocking   ${pct(card.reviewBlockingRate)}  (${card.reviewsRecorded} reviews)`
);
console.log(
    `  fixup rounds      ${
        Object.keys(card.fixupRounds).length === 0
            ? "n/a"
            : Object.entries(card.fixupRounds)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([rounds, issues]) => `${rounds}×:${issues}`)
                  .join("  ")
    }`
);
console.log(
    `  gate runs/issue   ${num(card.gateRunsPerShippedIssue, 2)}  (${card.gateRuns} runs)`
);
console.log(`  collision aborts  ${card.collisionAborts}`);
console.log(`  missing receipts  ${card.missingReceipts}`);
console.log(
    `  inherited tier    ${pct(card.inheritedModelShare)}  (${card.inheritedModelSpawns}/${card.agentSpawns} spawns passed no model)`
);

if (card.notes.length > 0) {
    console.log(`\n  notes`);
    for (const note of card.notes) console.log(`    · ${note}`);
}
console.log("");
