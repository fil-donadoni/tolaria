/**
 * The ONE builder of a `CoverageContext` off the committed tree (issue
 * #3868): `oracle:report --targets` renders from it and `check:targets` reds
 * on it, so the two can never read different markers, claims or closures.
 *
 * Offline: the lockfile, `data/card-index.json`, `data/grammar-gaps.json`,
 * the card set files and the catalogue — no corpus, no network.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAllCards } from "../../convex/cards/catalogue";
import { roundTripCard } from "../../convex/oracle/gold";
import { poolOracleIds } from "../oracle-compile";
import { isExempting, scanFilesForCompilerGaps } from "./compiler-gap-markers";
import { collectSetFiles } from "./divergence-markers";
import type { Lockfile } from "./oracle-lockfile";
import {
    gapIndex,
    parseClaims,
    type CoverageContext,
    type ResolveContext,
    type TargetRegistry,
} from "./targets";

/** The allowlist the claims live in, relative to the repo root. */
export const CLAIMS_PATH = "data/grammar-gaps.json";

/**
 * Oracle ids of the hand-written cards carrying a well-formed `hand-tail:`
 * marker. Fail-closed: a marked card whose name the lockfile cannot resolve
 * throws, rather than dropping out of the Hand Tail it declared.
 */
export function handTailOracleIds(
    root: string,
    byName: ResolveContext["byName"]
): Set<string> {
    const ids = new Set<string>();
    const markers = scanFilesForCompilerGaps(
        collectSetFiles(join(root, "convex", "cards", "sets"))
    );
    for (const marker of markers) {
        if (marker.kind !== "hand-tail" || !isExempting(marker)) continue;
        const row = byName.get(marker.card);
        if (row === undefined)
            throw new Error(
                `${marker.file}:${marker.line}: hand-tail card \`${marker.card}\` is not in the Oracle lockfile under exactly one oracle id`
            );
        ids.add(row.oracleId);
    }
    return ids;
}

/**
 * Oracle ids of the hand-written cards whose closure body the compiler now
 * produces a definition beside — Guard C's `incomparable`, through the same
 * single comparator (`roundTripCard`). A catalogue card the lockfile does not
 * carry cannot be a Target card, so it is skipped rather than thrown on.
 */
export function closureOracleIds(
    byName: ResolveContext["byName"]
): Set<string> {
    const ids = new Set<string>();
    for (const card of getAllCards()) {
        const { verdict } = roundTripCard(card);
        if (!verdict.ok || verdict.kind !== "incomparable") continue;
        const row = byName.get(card.name);
        if (row !== undefined) ids.add(row.oracleId);
    }
    return ids;
}

export function buildCoverageContext(
    root: string,
    lock: Pick<Lockfile, "cards" | "fragments">,
    registry: TargetRegistry,
    resolve: ResolveContext
): CoverageContext {
    const handWritten = poolOracleIds();
    if (handWritten.size === 0)
        throw new Error(
            "no hand-written cards read (data/card-index.json missing?); the playable " +
                "figure would shrink silently — run: bun run check:index"
        );
    return {
        floor: registry.handTailFloor,
        handWritten,
        handTail: handTailOracleIds(root, resolve.byName),
        closure: closureOracleIds(resolve.byName),
        claims: parseClaims(
            JSON.parse(readFileSync(join(root, CLAIMS_PATH), "utf8")),
            CLAIMS_PATH
        ),
        byOracleId: resolve.byOracleId,
        ...gapIndex(lock),
    };
}
