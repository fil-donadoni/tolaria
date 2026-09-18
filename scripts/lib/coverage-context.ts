/**
 * The ONE builder of a `CoverageContext` off the committed tree (issue
 * #3868): `oracle:report --targets` renders from it and `check:targets` reds
 * on it, so the two can never read different markers, claims or closures.
 *
 * Offline: the lockfile, `data/card-index.json`, `data/grammar-gaps.json`,
 * the card set files and the catalogue — no corpus, no network.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { getAllCards } from "../../convex/cards/catalogue";
import { roundTripCard } from "../../convex/oracle/gold";
import { poolOracleIds } from "../oracle-compile";
import {
    isExempting,
    scanCardAnchors,
    scanFilesForCompilerGaps,
} from "./compiler-gap-markers";
import { collectSetFiles } from "./divergence-markers";
import type { Graduate } from "./gap-kinds";
import type { CardRow, Lockfile } from "./oracle-lockfile";
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
 * The set sources scanned ONCE per root: three readers want the same files
 * (`hand-tail:` markers, `compiler-gap:` markers, the card → module map), and
 * `gaps:sync` calls all three in one run. Cached per root because a script is
 * a single-run process and the tree cannot change under it.
 */
const SET_SCANS = new Map<
    string,
    {
        markers: ReturnType<typeof scanFilesForCompilerGaps>;
        modules: Map<string, string>;
    }
>();

function setScan(root: string): {
    markers: ReturnType<typeof scanFilesForCompilerGaps>;
    modules: Map<string, string>;
} {
    const hit = SET_SCANS.get(root);
    if (hit !== undefined) return hit;
    const files = collectSetFiles(join(root, "convex", "cards", "sets"));
    const modules = new Map<string, string>();
    for (const file of files) {
        const rel = relative(root, file);
        for (const anchor of scanCardAnchors(
            readFileSync(file, "utf8").split("\n")
        ).anchors)
            modules.set(anchor.name, rel);
    }
    const scan = { markers: scanFilesForCompilerGaps(files), modules };
    SET_SCANS.set(root, scan);
    return scan;
}

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
    for (const marker of setScan(root).markers) {
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
 * Card NAMES carrying a well-formed `compiler-gap:` marker — the hand-written
 * cards whose author declared the grammar still owes a rule. `gaps:sync`
 * reports the ones whose gap has since fallen below the floor: their marker
 * claims a debt the grammar no longer has, and the card is Hand Tail
 * (issue #3869). Names, not oracle ids: a marker that resolves to no lockfile
 * row is Guard C's red, not this reader's.
 */
export function compilerGapCards(root: string): Set<string> {
    const names = new Set<string>();
    for (const marker of setScan(root).markers)
        if (marker.kind === "compiler-gap" && isExempting(marker))
            names.add(marker.card);
    return names;
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

/** Card name → the set module its hand-written definition lives in, repo
 *  relative. Read off the SAME anchor scanner Guard C's markers attach to. */
export function cardModules(root: string): Map<string, string> {
    return setScan(root).modules;
}

/** Every card test file under `convex/cards`, repo relative. Card tests are
 *  COLOUR-SPLIT PER SET (ADR 0043) — `convex/cards/sets/<set>/__tests__/` —
 *  so a non-recursive read of `convex/cards/__tests__` sees a twentieth of
 *  them and reports "no test" for cards a per-set file names (review of
 *  PR #3978: 58 of 383 graduates). */
export function cardTestFiles(root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".test.ts"))
                out.push(relative(root, full));
        }
    };
    const cards = join(root, "convex", "cards");
    if (existsSync(cards)) walk(cards);
    return out.sort();
}

/**
 * Card name → the test files that name it. Indexes only the names asked for:
 * indexing every string literal instead matched `"Island"` in two files that
 * are about neither card (review of PR #3978).
 */
export function perCardTests(
    root: string,
    names: ReadonlySet<string>
): Map<string, string[]> {
    const index = new Map<string, string[]>();
    for (const rel of cardTestFiles(root)) {
        const text = readFileSync(join(root, rel), "utf8");
        for (const name of names) {
            if (!text.includes(`"${name}"`)) continue;
            const bucket = index.get(name);
            if (bucket === undefined) index.set(name, [rel]);
            else bucket.push(rel);
        }
    }
    return index;
}

/**
 * The GRADUATES (issue #3869): hand-written cards the compiler now reproduces
 * exactly — Guard C verdict `equal` — whose lockfile row is `ready` and not
 * already retired (ADR 0114). A closure card (`incomparable`) is never one:
 * that verdict proves the text compiles, never that the definition equals the
 * closure, so equality is unproven (grill, issue #3867).
 */
export function buildGraduates(
    root: string,
    resolve: ResolveContext
): Graduate[] {
    const rows: Array<{ name: string; row: CardRow }> = [];
    for (const card of getAllCards()) {
        const { verdict } = roundTripCard(card);
        if (!verdict.ok || verdict.kind !== "equal") continue;
        const named = resolve.byName.get(card.name);
        if (named === undefined) continue;
        const row = resolve.byOracleId.get(named.oracleId);
        if (row === undefined || row.state !== "ready") continue;
        if (row.retired !== undefined) continue;
        rows.push({ name: card.name, row });
    }
    const modules = cardModules(root);
    const tests = perCardTests(root, new Set(rows.map((entry) => entry.name)));
    return rows.map(({ name, row }) => ({
        oracleId: row.oracleId,
        name: row.name,
        module: modules.get(name) ?? "(module not found)",
        tests: tests.get(name) ?? [],
        slots: row.slots ?? [],
    }));
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
