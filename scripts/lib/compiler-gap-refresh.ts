// The I/O half of the `compiler-gap:` marker refresh (issue #7671): the plan
// over the live catalogue, shared by `oracle:mark-regressions --refresh` and
// Guard C's "refresh would change nothing" test so the two cannot disagree.

import { readFileSync } from "node:fs";
import type { CardDefinition } from "../../convex/cards/types";
import { roundTripCard } from "../../convex/oracle/gold";
import {
    planMarkerRefresh,
    scanFilesForCompilerGaps,
    type MarkerRefreshPlan,
    type RefreshOutcome,
} from "./compiler-gap-markers";
import { matchingClusterIssues } from "./gap-issues";
import { gapOf } from "./grammar-gaps";
import { parseClaimRows, parseClusterRows } from "./targets";

export const GRAMMAR_GAP_ALLOWLIST = "data/grammar-gaps.json";

/** key → the issue `gaps:sync` filed for it: the `grammar` claim row, else the
 *  lowest matching Cluster Signature (`matchCluster`'s order). Offline. */
export function grammarIssueResolver(
    allowlistPath: string = GRAMMAR_GAP_ALLOWLIST
): (key: string) => number | undefined {
    const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
    const claimed = new Map(
        parseClaimRows(allowlist, allowlistPath)
            .filter((row) => row.kind === "grammar")
            .map((row) => [row.key, row.issue] as const)
    );
    const clusters = parseClusterRows(allowlist, allowlistPath);
    return (key) =>
        claimed.get(key) ??
        matchingClusterIssues({ kind: "grammar", key }, clusters)[0];
}

/** The refresh plan over `files` and the catalogue `cards`. */
export function planCatalogueRefresh(
    files: readonly string[],
    cards: readonly CardDefinition[],
    issueOf: (key: string) => number | undefined = grammarIssueResolver()
): MarkerRefreshPlan {
    const markers = scanFilesForCompilerGaps(files);
    const wanted = new Set(
        markers.filter((m) => m.kind === "compiler-gap").map((m) => m.card)
    );
    const outcomes = new Map<string, RefreshOutcome>();
    for (const card of cards) {
        if (!wanted.has(card.name)) continue;
        const { verdict, outcome } = roundTripCard(card);
        outcomes.set(
            card.name,
            verdict.ok
                ? { state: "round-trips" }
                : verdict.kind === "unparsed" && outcome?.state === "unparsed"
                  ? { state: "unparsed", gaps: outcome.gaps }
                  : { state: "other" }
        );
    }
    return planMarkerRefresh(
        markers,
        (card) => outcomes.get(card),
        (gap) =>
            gapOf({
                text: gap.fragment,
                reason: gap.reason,
                attribution: gap.attribution,
            }).key,
        issueOf
    );
}
