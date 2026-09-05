#!/usr/bin/env bun
/**
 * `bun run oracle:triage` — Guard C's baseline, split by DIRECTION OF DEFECT
 * (issue #3050, ADR 0114 §5).
 *
 * Answers the question a shrinking count cannot: of the cards that do not
 * round-trip, how many are waiting on the GRAMMAR and how many are waiting on a
 * CARD FIX? The two feed different backlogs, and merging them is how Northern
 * Paladin (#3046) and Ashnod's Altar (#3047) sat unseen in a list labelled, in
 * effect, "the compiler can't read this yet".
 *
 * Recomputes every row's verdict live through `roundTripCard` — the same single
 * comparator Guard C and the gold harness use — so this report and the gate can
 * never disagree. It reads the CATALOGUE, not the lockfile, because the
 * question is about hand-written cards rather than about corpus coverage
 * (`bun run oracle:report` is the lockfile-backed one).
 *
 * Usage:
 *   bun scripts/oracle-baseline-triage.ts            # counts + the two small classes by name
 *   bun scripts/oracle-baseline-triage.ts --all      # also list the compiler-gap class
 */

import { getAllCards } from "../convex/cards/catalogue";
import { BASELINE_ROWS } from "../convex/cards/__tests__/compilerRoundTrip.baseline";
import {
    BASELINE_DIRECTIONS,
    describeInconsistent,
    triageBaseline,
    type BaselineDirection,
    type TriagedRow,
} from "./lib/baseline-triage";

/** What each class is FOR — printed with its count, so the report says what to
 *  do with the number rather than only what the number is. */
const FEEDS: Record<BaselineDirection, string> = {
    "compiler-gap": "the grammar backlog (PRD #2693 user story 9)",
    "card-defect": "a card fix ticket",
    undetermined: "a person — a queue, not a resting place",
};

function pct(n: number, total: number): string {
    return total === 0 ? "  0.0%" : `${((n / total) * 100).toFixed(1)}%`;
}

const clip = (text: string, width: number): string =>
    text.length > width ? `${text.slice(0, width - 1)}…` : text;

/**
 * A window onto the FIRST character where the two projections diverge.
 *
 * Printing the two projections from offset 0 and clipping them to a terminal
 * width showed the same prefix twice and truncated one character into the only
 * field that differed — on Northern Paladin, the card this slice is named
 * after. Diffing top-level keys is no better: every one of the eight
 * mismatches differs INSIDE `activatedAbilities`, `modes` or `effects`, so the
 * differing "key" is the whole ability. Anchoring on the first divergence is
 * depth-independent and needs no knowledge of the projection's shape.
 *
 * `CONTEXT` characters of agreement are kept before the divergence so the
 * window lands in a readable place rather than mid-token.
 */
const CONTEXT = 40;

function divergenceWindow(
    expected: string,
    actual: string
): { readonly at: number; readonly gold: string; readonly mine: string } {
    let at = 0;
    while (
        at < expected.length &&
        at < actual.length &&
        expected[at] === actual[at]
    ) {
        at += 1;
    }
    const from = Math.max(0, at - CONTEXT);
    const lead = from === 0 ? "" : "…";
    return {
        at,
        gold: lead + clip(expected.slice(from), 150),
        mine: lead + clip(actual.slice(from), 150),
    };
}

/**
 * One row per card; for a `mismatch`, the window around the first divergence.
 * See {@link divergenceWindow}.
 */
function listRows(rows: readonly TriagedRow[]): void {
    for (const row of rows) {
        if (row.kind !== "mismatch") {
            process.stdout.write(
                `  ${row.name.padEnd(34)} ${row.kind.padEnd(15)} ${clip(row.detail, 96)}\n`
            );
            continue;
        }
        const { at, gold, mine } = divergenceWindow(
            row.expected ?? "",
            row.actual ?? ""
        );
        process.stdout.write(
            `  ${row.name.padEnd(34)} mismatch — first divergence at char ${at}\n` +
                `      hand-written  ${gold}\n` +
                `      compiled      ${mine}\n`
        );
    }
}

function main(): void {
    const listAll = process.argv.includes("--all");
    const triage = triageBaseline(getAllCards(), BASELINE_ROWS);

    process.stdout.write(
        `\nGuard C baseline — ${BASELINE_ROWS.length} rows, triaged by direction of defect\n` +
            `(issue #3050, ADR 0114 §5)\n\n`
    );
    process.stdout.write(
        `${"direction".padEnd(16)}${"rows".padStart(7)}${"share".padStart(9)}  feeds\n` +
            `${"-".repeat(78)}\n`
    );
    for (const direction of BASELINE_DIRECTIONS) {
        const n = triage.counts[direction];
        process.stdout.write(
            `${direction.padEnd(16)}${String(n).padStart(7)}` +
                `${pct(n, triage.total).padStart(9)}  ${FEEDS[direction]}\n`
        );
    }
    process.stdout.write(
        `${"-".repeat(78)}\n${"total".padEnd(16)}${String(triage.total).padStart(7)}\n`
    );

    process.stdout.write(
        `\ncard-defect (${triage.counts["card-defect"]}) — the hand-written side is wrong; ` +
            `fixing the card graduates the row:\n`
    );
    listRows(triage.byDirection["card-defect"]);

    process.stdout.write(
        `\nundetermined (${triage.counts.undetermined}) — the compiler produced a definition, ` +
            `the two disagree, nobody has adjudicated:\n`
    );
    listRows(triage.byDirection.undetermined);

    if (listAll) {
        process.stdout.write(
            `\ncompiler-gap (${triage.counts["compiler-gap"]}):\n`
        );
        listRows(triage.byDirection["compiler-gap"]);
    } else {
        process.stdout.write(
            `\ncompiler-gap (${triage.counts["compiler-gap"]}) not listed — pass --all. ` +
                `Its fragments are\nranked for you by \`bun run oracle:report\`.\n`
        );
    }

    // Both of these are Guard C's job to RED on; printed here so a run of the
    // report is never quietly describing a baseline that has already rotted.
    if (triage.inconsistent.length > 0) {
        process.stdout.write(
            `\n✗ ${triage.inconsistent.length} row(s) filed under a direction their verdict cannot support:\n`
        );
        for (const row of triage.inconsistent) {
            process.stdout.write(`  ${describeInconsistent(row)}\n`);
        }
    }
    if (triage.stale.length > 0) {
        process.stdout.write(
            `\n✗ ${triage.stale.length} stale row(s) — the baseline is SHRINK-ONLY, delete them:\n`
        );
        for (const line of triage.stale) {
            process.stdout.write(`  ${line}\n`);
        }
    }
    process.stdout.write("\n");
    if (triage.inconsistent.length > 0 || triage.stale.length > 0) {
        process.exit(1);
    }
}

main();
