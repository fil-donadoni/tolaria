#!/usr/bin/env bun
/**
 * `bun run oracle:mark-regressions` — write the `compiler-gap:` marker of a
 * hand-written card a grammar change stopped round-tripping (issue #5988).
 *
 * Guard C (`convex/cards/__tests__/compilerRoundTrip.test.ts`) reds a card
 * that does not round-trip and carries neither a marker nor a baseline row,
 * and the baseline only shrinks (issue #5942). For an `unparsed` verdict the
 * marker is transcription: the fragment is the compiler's own `Gap`, the issue
 * is the Grammar Gap `gaps:sync` filed for that gap's key — its `grammar`
 * claim row in `data/grammar-gaps.json`, keyed by `gapOf` exactly as
 * `gaps:sync` keys it. This writes those markers; it never writes one it
 * would have to invent:
 *
 *   mismatch        the compiler read the card and disagrees — a card or
 *                   compiler defect; Guard C's `misfiledMarkers` refuses a
 *                   marker on it anyway
 *   unfiled         a gap with no filed issue yet — neither a claim row nor
 *                   a Cluster Signature names it; `gaps:sync` files it
 *                   post-merge, from the primary checkout
 *   no-oracle-text  the compiler's input is missing
 *
 * are REPORTED, and the run exits 1 so the caller sees a person is owed.
 * Same verdicts as Guard C (`roundTripCard`, the single comparator), same
 * exemptions (an exempting marker of either kind, a baseline row), so a second
 * run finds nothing to write — idempotent by construction.
 *
 * Wired into `/grammar-rule` step 8 (graduation): a grammar change is the one
 * diff that can regress a card, and step 8 is where that run first reads Guard
 * C's red.
 *
 * Usage:
 *   bun run oracle:mark-regressions             # write the markers
 *   bun run oracle:mark-regressions --dry-run   # print the plan, write nothing
 */

import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { getAllCards } from "../convex/cards/catalogue";
import { COMPILER_ROUND_TRIP_BASELINE } from "../convex/cards/__tests__/compilerRoundTrip.baseline";
import { roundTripCard } from "../convex/oracle/gold";
import {
    insertCompilerGapMarkers,
    isExempting,
    planRegressionMarkers,
    scanCardAnchors,
    scanFilesForCompilerGaps,
    type RegressedCard,
} from "./lib/compiler-gap-markers";
import { SETS_DIR, collectSetFiles } from "./lib/divergence-markers";
import { gapOf } from "./lib/grammar-gaps";
import { matchingClusterIssues } from "./lib/gap-issues";
import { parseClaimRows, parseClusterRows } from "./lib/targets";

const ALLOWLIST = "data/grammar-gaps.json";

function main(argv: readonly string[]): number {
    const dryRun = argv.includes("--dry-run");
    const files = collectSetFiles(SETS_DIR);
    const exempt = new Set([
        ...COMPILER_ROUND_TRIP_BASELINE,
        ...scanFilesForCompilerGaps(files)
            .filter(isExempting)
            .map((m) => m.card),
    ]);

    const regressed: RegressedCard[] = [];
    for (const card of getAllCards()) {
        if (exempt.has(card.name)) continue;
        const { verdict, outcome } = roundTripCard(card);
        if (verdict.ok) continue;
        regressed.push({
            name: card.name,
            kind: verdict.kind,
            detail: verdict.detail,
            gaps: outcome?.state === "unparsed" ? outcome.gaps : undefined,
        });
    }

    // The two records `gaps:sync` maps a gap key to an issue by: the key's
    // own `grammar` claim row (the issue it filed, or the cluster that adopted
    // it), else a Cluster Signature matching the key — lowest issue first,
    // `matchCluster`'s order. Offline: an issue's open state is not read here,
    // as Guard C never reads it (`check-marker-liveness.ts` does).
    const allowlist = JSON.parse(readFileSync(ALLOWLIST, "utf8"));
    const grammarIssue = new Map(
        parseClaimRows(allowlist, ALLOWLIST)
            .filter((row) => row.kind === "grammar")
            .map((row) => [row.key, row.issue] as const)
    );
    const clusters = parseClusterRows(allowlist, ALLOWLIST);
    const issueOf = (key: string): number | undefined =>
        grammarIssue.get(key) ??
        matchingClusterIssues({ kind: "grammar", key }, clusters)[0];
    const plan = planRegressionMarkers(
        regressed,
        (gap) =>
            gapOf({
                text: gap.fragment,
                reason: gap.reason,
                cards: 1,
                attribution: gap.attribution,
            }).key,
        issueOf
    );

    const placed = new Set<string>();
    for (const file of files) {
        const lines = readFileSync(file, "utf8").split("\n");
        const names = scanCardAnchors(lines).anchors.map((a) => a.name);
        const mine = new Map(
            [...plan.mark].filter(([card]) => names.includes(card))
        );
        if (mine.size === 0) continue;
        const { lines: next, written } = insertCompilerGapMarkers(lines, mine);
        for (const card of written) {
            placed.add(card);
            for (const m of mine.get(card)!) {
                console.log(
                    `${dryRun ? "would mark" : "marked"} ${card} (${path.relative(SETS_DIR, file)}): ${m.fragment} (#${m.issue})`
                );
            }
        }
        if (!dryRun) writeFileSync(file, next.join("\n"));
    }

    const report = [
        ...plan.report,
        ...[...plan.mark.keys()]
            .filter((card) => !placed.has(card))
            .map((card) => ({
                card,
                problem: "no anchor" as const,
                detail: "no `defineCard` anchor under convex/cards/sets/ names this card",
            })),
    ];
    for (const r of report) {
        console.log(`NOT MARKED ${r.card}: ${r.problem} — ${r.detail}`);
    }
    console.log(
        `oracle:mark-regressions: ${placed.size} card(s) ${dryRun ? "to mark" : "marked"}, ${report.length} owed a person`
    );
    return report.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
