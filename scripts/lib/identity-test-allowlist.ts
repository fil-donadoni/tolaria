import * as fs from "fs";
import * as path from "path";
import type { TestBlock } from "./identity-test-classifier";

/**
 * Named allow-list for the identity-test classifier's repo-wide scope
 * (issue #4489).
 *
 * Outside the card-set suites a block that calls nothing is not always a
 * definition written twice: a census (every member of A has a row in B), a
 * partition (every item in exactly one bucket), a uniqueness or drift check
 * between two independently maintained sources — these assert over static data
 * and still fail for a reason someone wants to hear about. They are exempted
 * HERE, one entry per test, by NAME (file + describe chain + title, never a
 * line number, so an unrelated edit above a block does not orphan its entry),
 * and every entry carries its reason.
 *
 * An entry exempts the block from both identity rules: the whole-block verdict
 * and the definition-read lines. `bun scripts/purge-identity-tests.ts --dry`
 * reports entries that no longer match any block — a stale entry is deleted,
 * never kept "just in case".
 *
 * `convex/cards/sets/**` gets no entries: the #2363 guard there has an empty
 * allow-list by design (`scripts/__tests__/identity-only-card-tests.test.ts`).
 */
export interface AllowListEntry {
    /** Repo-relative test file. */
    file: string;
    /** `describe > … > title`, as `testName()` renders it. */
    test: string;
    /** What invariant the block guards that no call-bearing test does. */
    reason: string;
}

/** The block's name: its describe chain and title (a template's source text), `<dynamic>` for any other computed title. */
export function testName(
    block: Pick<TestBlock, "describeChain" | "title">
): string {
    return [...block.describeChain, block.title ?? "<dynamic>"].join(" > ");
}

const key = (file: string, test: string) => `${file}::${test}`;

/**
 * The entries live in `identity-test-allowlist.json` beside this file — data,
 * not source: an entry quotes a test's name verbatim, and names carry
 * `CR <id>` citations that `cr:lint` would otherwise demand a second ledger
 * entry for (the original line in the test is the citation of record).
 *
 * Seeded 2026-09-24 from a per-block triage of the 258 blocks the classifier
 * flagged repo-wide: 197 census / partition / drift checks, 61 true identity
 * blocks (left flagged, for the purge ticket) — plus this list's own hygiene
 * census in `purge-identity-tests.test.ts`.
 */
export const IDENTITY_ALLOWLIST: readonly AllowListEntry[] = JSON.parse(
    fs.readFileSync(
        path.join(__dirname, "identity-test-allowlist.json"),
        "utf-8"
    )
) as AllowListEntry[];

const keySets = new WeakMap<readonly AllowListEntry[], Set<string>>();
function keysOf(list: readonly AllowListEntry[]): Set<string> {
    let keys = keySets.get(list);
    if (!keys) {
        keys = new Set(list.map((e) => key(e.file, e.test)));
        keySets.set(list, keys);
    }
    return keys;
}

export function isAllowListed(
    block: Pick<TestBlock, "file" | "describeChain" | "title">,
    list: readonly AllowListEntry[] = IDENTITY_ALLOWLIST
): boolean {
    return keysOf(list).has(key(block.file, testName(block)));
}

/**
 * Allow-list hygiene over a classified tree:
 *   - `stale`: the entry exempts nothing — no block of that name is still
 *     flagged (identity, or carrying definition-read lines). Delete it.
 *   - `ambiguous`: the name matches more than one block (a computed title, a
 *     repeated one), so the entry silently exempts all of them.
 */
export function staleEntries(
    blocks: readonly Pick<
        TestBlock,
        "file" | "describeChain" | "title" | "verdict" | "definitionReads"
    >[],
    list: readonly AllowListEntry[] = IDENTITY_ALLOWLIST
): { stale: AllowListEntry[]; ambiguous: AllowListEntry[] } {
    const matches = new Map<string, number>();
    const flagged = new Set<string>();
    for (const b of blocks) {
        const k = key(b.file, testName(b));
        matches.set(k, (matches.get(k) ?? 0) + 1);
        if (b.verdict === "identity" || b.definitionReads.length > 0)
            flagged.add(k);
    }
    return {
        stale: list.filter((e) => !flagged.has(key(e.file, e.test))),
        ambiguous: list.filter(
            (e) => (matches.get(key(e.file, e.test)) ?? 0) > 1
        ),
    };
}
