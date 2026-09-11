#!/usr/bin/env bun
/**
 * One-shot backfill of the lockfile `data/card-index.json` (ADR 0041).
 *
 * The lockfile is the committed central index of every implemented card —
 * `{ name, scryfallId, oracleId, firstSet, firstPrintId, firstPrintSet }` — and
 * is what `list-to-cards.mjs` dedups against (by `oracleId`) and what the
 * id-guard validates against. The existing catalogue predates the lockfile, so
 * this script seeds it from the registry: every `CardDefinition.id` is a
 * Scryfall print id, and one `POST /cards/collection` per 75 ids returns that
 * print's `oracle_id` + `set` + `reprint` flag.
 *
 * `firstPrintId` / `firstPrintSet` name the card's EARLIEST PAPER printing
 * (ADR 0041's "home set = earliest paper printing"), which is what
 * `check-card-index.ts` asserts every `CardDefinition.id` equals — the offline
 * guard against implementing a card against a reprint (wrong home set, wrong
 * art). Only a print Scryfall flags as a `reprint` needs the extra per-oracle
 * prints query; for everything else the def's own id IS the first printing.
 *
 * Run with bun (executes TypeScript directly):
 *   bun run scripts/backfill-card-index.ts
 *
 * Idempotent: existing lockfile entries are preserved; only missing scryfallIds
 * are fetched and appended. Re-run after adding cards the tool didn't index.
 *
 * `--refresh <name|oracleId|scryfallId>` RE-RESOLVES a row already in the
 * lockfile (issue #3423) — the one thing a plain run can never do, since it
 * skips everything present. That was the whole repair path for a row pinned to
 * the wrong printing, and the alternative was a hand edit, which the lockfile
 * forbids:
 *
 *   bun run scripts/backfill-card-index.ts --refresh "Shadowblood Ridge"
 *
 * A FAILED first-printing lookup writes NOTHING and exits non-zero. It used to
 * fall back to the print in hand, which the caller then wrote into both
 * `scryfallId` and `firstPrintId` — the exact pair `check-card-index.ts`
 * compares against each other, so the guess landed pre-verified and the guard
 * printed "every card on its first printing" over it. See
 * `scripts/lib/first-paper-print.ts`.
 *
 * `--prune` additionally REMOVES pollution rows — a row with no
 * `CardDefinition` behind it any more (a card that was deleted or renamed),
 * as `check-card-index.ts` defines it. Pruning is opt-in because it deletes
 * committed data, and it is the ONLY correct way to clear an `extra`.
 *
 * NEVER truncate the lockfile to an empty array first. That does clear
 * pollution, which is why it used to be the written recipe, but it also
 * destroys every `source: "compiled"` row (~1400 of them), which this script
 * CANNOT regenerate — those come from `oracle-index-backfill.ts` and its own
 * Scryfall pass. `--prune` shares `isPollutionEntry` with the guard, so it
 * removes exactly the rows the guard complained about and nothing else.
 *
 * Also GRADUATES `source: "compiled"` rows (`oracle-index-backfill.ts`,
 * issue #2702): if a hand-written `CardDefinition` now exists for a
 * previously compiled-only oracle id (ADR 0108 guarantees the same
 * `scryfallId`), the stale tag is cleared so `poolOracleIdsFromIndex` /
 * `dedupByOracle` / `knownImplementedNames` count it as implemented again
 * (`graduateCompiledEntries`, PR #2838 round 3).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getAllCards } from "../convex/cards/index";
// The SAME predicate `check-card-index.ts` calls a row "pollution" with, so
// `--prune` can never remove a row the guard would have kept (or keep one it
// would have flagged) — one authority, two callers.
import { isPollutionEntry } from "./lib/card-index-pollution";
// Fail-closed first-printing resolver, shared with `oracle-index-backfill.ts`
// (issue #3423). `null` means "Scryfall could not answer" — never a guess.
import {
    SCRYFALL,
    resolveFirstPaperPrint,
    type PaperPrint,
} from "./lib/first-paper-print";

export type Entry = {
    name: string;
    scryfallId: string;
    oracleId: string;
    /** Set of the printing `scryfallId` names. */
    firstSet: string;
    /** Scryfall id of the card's earliest PAPER printing (ADR 0041). Equals
     *  `scryfallId` for a correctly-homed card — that equality is the guard. */
    firstPrintId: string;
    /** Set code of `firstPrintId`. */
    firstPrintSet: string;
    /** Present + `"compiled"` iff this row was written ONLY by
     *  `oracle-index-backfill.ts` (issue #2702) — absent (the default) means
     *  a hand-written `CardDefinition` backed it, either from the start or
     *  because it GRADUATED (see `graduateCompiledEntries` below). This
     *  script's own writes (`byId.set` in the fetch loop) never set it —
     *  only present on rows this script did not itself create. */
    source?: "compiled";
};

/** A `source: "compiled"` row (`oracle-index-backfill.ts`, issue #2702) whose
 *  `scryfallId` now ALSO has a hand-written `CardDefinition` has GRADUATED —
 *  ADR 0108 makes the compiled row's `scryfallId` the same `firstPrintId` a
 *  hand-written card for that oracle id takes, so the two rows collide on
 *  the SAME id rather than living side by side. Every consumer of `source`
 *  (`oracle-compile.ts`'s `poolOracleIdsFromIndex`, `list-to-cards.mjs`'s
 *  `dedupByOracle`/`knownImplementedNames`) filters `source !== "compiled"`
 *  to mean "counts as implemented" — leaving a graduated row tagged
 *  `"compiled"` forever makes it under-count the PRD #2693 pool metric by
 *  one AND re-stage an already-implemented card into the worklist importer
 *  (PR #2838 round 3 finding). Mutates in place (the caller's `byId` Map
 *  holds these same object references) and returns the count cleared, so a
 *  zero-graduation run can skip the write. */
export function graduateCompiledEntries(
    entries: readonly Entry[],
    registryScryfallIds: ReadonlySet<string>
): number {
    let graduated = 0;
    for (const entry of entries) {
        if (
            entry.source === "compiled" &&
            registryScryfallIds.has(entry.scryfallId)
        ) {
            delete entry.source;
            graduated++;
        }
    }
    return graduated;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Resolved = Map<
    string,
    { oracleId: string; set: string; reprint: boolean }
>;

/** POST one ≤75-id batch. Returns null if Scryfall rejects it (HTTP 400 — a
 *  malformed/unknown identifier poisons the whole request), so the caller can
 *  bisect to isolate the offender. */
async function postBatch(
    ids: string[],
    attempts = 5
): Promise<Resolved | null> {
    let res: Response | undefined;
    for (let a = 1; a <= attempts; a++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20000);
        try {
            res = await fetch(`${SCRYFALL}/cards/collection`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    "User-Agent": "tolaria-backfill/1.0",
                },
                body: JSON.stringify({
                    identifiers: ids.map((id) => ({ id })),
                }),
                signal: ctrl.signal,
            });
        } catch {
            clearTimeout(timer);
            if (a < attempts) {
                await sleep(1000 * a);
                continue;
            }
            throw new Error("Scryfall collection: network error after retries");
        }
        clearTimeout(timer);
        // 429 / 5xx — back off and retry (honour Retry-After when present)
        if ((res.status === 429 || res.status >= 500) && a < attempts) {
            const retryAfter = Number(res.headers.get("retry-after")) || 0;
            await sleep(Math.max(retryAfter * 1000, 2000 * a));
            continue;
        }
        break;
    }
    await sleep(150);
    if (!res) throw new Error("Scryfall collection: no response");
    if (res.status === 400) return null;
    if (!res.ok) throw new Error(`Scryfall collection HTTP ${res.status}`);
    const json = (await res.json()) as {
        data: Array<{
            id: string;
            oracle_id: string;
            set: string;
            reprint?: boolean;
        }>;
    };
    const out: Resolved = new Map();
    for (const c of json.data)
        out.set(c.id, {
            oracleId: c.oracle_id,
            set: c.set,
            reprint: c.reprint === true,
        });
    return out;
}

/** Resolve a batch, bisecting on HTTP 400 to skip the single bad identifier.
 *  Ids that resolve to nothing (not_found) simply never appear in the map. */
async function resolveBatch(ids: string[]): Promise<Resolved> {
    const ok = await postBatch(ids);
    if (ok) return ok;
    if (ids.length === 1) {
        console.warn(`  rejected by Scryfall (skipped): ${ids[0]}`);
        return new Map();
    }
    const mid = Math.floor(ids.length / 2);
    const left = await resolveBatch(ids.slice(0, mid));
    const right = await resolveBatch(ids.slice(mid));
    return new Map([...left, ...right]);
}

/** Build one chunk's worth of lockfile rows from the collection lookup plus a
 *  first-printing RESOLVER, and report which cards the resolver could not
 *  answer for.
 *
 *  A card whose prints lookup fails gets NO ROW (issue #3423). The old code
 *  wrote the print in hand into both `scryfallId` and `firstPrintId`, which is
 *  the exact pair `check-card-index.ts` compares — a guess that lands
 *  pre-verified. A missing row is the loud failure mode: the guard reports it
 *  as missing and the next run re-fetches it.
 *
 *  Exported so that contract is testable without the network. */
export async function buildEntriesForChunk(
    chunk: ReadonlyArray<{ id: string; name: string }>,
    batch: Resolved,
    resolvePrint: (oracleId: string) => Promise<PaperPrint | null>
): Promise<{
    entries: Entry[];
    unresolvedPrints: Array<{ id: string; name: string }>;
}> {
    const entries: Entry[] = [];
    const unresolvedPrints: Array<{ id: string; name: string }> = [];
    for (const c of chunk) {
        const r = batch.get(c.id);
        if (!r) continue; // unresolved (bad id / not_found) — reported on re-run
        const first = r.reprint
            ? await resolvePrint(r.oracleId)
            : { id: c.id, set: r.set, rarity: "" };
        if (!first) {
            unresolvedPrints.push({ id: c.id, name: c.name });
            continue;
        }
        entries.push({
            name: c.name,
            scryfallId: c.id,
            oracleId: r.oracleId,
            firstSet: r.set,
            firstPrintId: first.id,
            firstPrintSet: first.set,
        });
    }
    return { entries, unresolvedPrints };
}

/** `--refresh <name|oracleId|scryfallId>` — re-resolve rows ALREADY in the
 *  lockfile (issue #3423). The backfill skips everything present, so a row
 *  poisoned before the fail-closed resolver existed had no repair path but a
 *  hand edit, which the lockfile forbids.
 *
 *  What gets rewritten depends on the row:
 *
 *   - a `source: "compiled"` row has no `CardDefinition` behind it — its
 *     `scryfallId` IS the first printing (ADR 0108), so all of
 *     `scryfallId`/`firstSet`/`firstPrintId`/`firstPrintSet`/`rarity` move;
 *   - a hand-written row's `scryfallId` is the `CardDefinition.id` and stays
 *     put: only `firstPrintId`/`firstPrintSet` are re-resolved, so a card
 *     implemented against a reprint shows up as ADR 0041 drift in
 *     `check:index` — which is that guard's whole job.
 *
 *  Returns the rows it changed. A resolver that answers `null` changes
 *  nothing and is reported by the caller as a failure. */
export async function refreshEntries(
    rows: Entry[],
    resolvePrint: (oracleId: string) => Promise<PaperPrint | null>
): Promise<{
    changed: Array<{ before: Entry; after: Entry }>;
    unresolved: Entry[];
}> {
    const changed: Array<{ before: Entry; after: Entry }> = [];
    const unresolved: Entry[] = [];
    for (const row of rows) {
        const first = await resolvePrint(row.oracleId);
        if (!first) {
            unresolved.push(row);
            continue;
        }
        const before = { ...row };
        if (row.source === "compiled") {
            row.scryfallId = first.id;
            row.firstSet = first.set;
            if (first.rarity)
                (row as { rarity?: string }).rarity = first.rarity;
        }
        row.firstPrintId = first.id;
        row.firstPrintSet = first.set;
        if (JSON.stringify(before) !== JSON.stringify(row))
            changed.push({ before, after: row });
    }
    return { changed, unresolved };
}

/** Rows a `--refresh <query>` names: exact oracle id, exact print id, or
 *  case-insensitive full name (a name can match a compiled row AND a
 *  hand-written one — both are refreshed). */
export function selectRefreshRows(rows: Entry[], query: string): Entry[] {
    const q = query.trim().toLowerCase();
    return rows.filter(
        (e) =>
            e.oracleId.toLowerCase() === q ||
            e.scryfallId.toLowerCase() === q ||
            e.name.toLowerCase() === q
    );
}

async function main() {
    const lockPath = resolve("data/card-index.json");
    const existing: Entry[] = existsSync(lockPath)
        ? JSON.parse(readFileSync(lockPath, "utf-8"))
        : [];
    const byId = new Map(existing.map((e) => [e.scryfallId, e]));

    const writeLock = () => {
        const merged = [...byId.values()].sort((a, b) =>
            a.name.localeCompare(b.name)
        );
        writeFileSync(
            lockPath,
            JSON.stringify(merged, null, 4) + "\n",
            "utf-8"
        );
    };

    // `--refresh <name|oracleId|scryfallId>` — re-resolve rows already in the
    // lockfile (issue #3423). Runs alone: no graduation, no prune, no fetch of
    // missing cards, so a repair touches exactly the rows it names.
    const refreshIdx = process.argv.indexOf("--refresh");
    if (refreshIdx !== -1) {
        const query = process.argv[refreshIdx + 1];
        if (!query || query.startsWith("--")) {
            console.error(
                "✗ --refresh needs a card name, oracle id or print id:\n" +
                    '  bun run scripts/backfill-card-index.ts --refresh "Shadowblood Ridge"'
            );
            process.exit(1);
        }
        const rows = selectRefreshRows(existing, query);
        if (rows.length === 0) {
            console.error(`✗ no lockfile row matches "${query}".`);
            process.exit(1);
        }
        const { changed, unresolved } = await refreshEntries(rows, (oracleId) =>
            resolveFirstPaperPrint(oracleId, {
                userAgent: "tolaria-backfill/1.0",
            })
        );
        if (unresolved.length) {
            console.error(
                `✗ first-printing lookup failed for ${unresolved.length} row(s) — ` +
                    `lockfile left untouched:`
            );
            for (const e of unresolved)
                console.error(`  - ${e.name} (${e.oracleId})`);
            process.exit(1);
        }
        if (changed.length === 0) {
            console.log(
                `✓ ${rows.length} row(s) matched "${query}" — already on their first printing.`
            );
            return;
        }
        // A compiled row's key IS its `scryfallId`, so a moved id needs the
        // map re-keyed, not just the value mutated.
        for (const { before, after } of changed) {
            if (before.scryfallId !== after.scryfallId)
                byId.delete(before.scryfallId);
            byId.set(after.scryfallId, after);
            console.log(
                `  ${after.name}: ${before.firstPrintSet} ${before.firstPrintId} → ` +
                    `${after.firstPrintSet} ${after.firstPrintId}`
            );
        }
        writeLock();
        console.log(`✓ refreshed ${changed.length} row(s) → ${lockPath}`);
        return;
    }

    const cards = getAllCards();
    const registryScryfallIds = new Set(cards.map((c) => c.id));
    const graduated = graduateCompiledEntries(existing, registryScryfallIds);

    // `--prune` — drop rows the guard calls pollution. Runs AFTER graduation
    // (a graduated row has just lost its `source` tag and IS in the registry,
    // so it is never pollution) and before the fetch, so the summary line
    // counts the post-prune lockfile.
    const prune = process.argv.includes("--prune");
    let pruned = 0;
    if (prune) {
        for (const entry of existing) {
            if (isPollutionEntry(entry, registryScryfallIds)) {
                byId.delete(entry.scryfallId);
                pruned++;
            }
        }
    }

    const missing = cards.filter((c) => !byId.has(c.id));
    console.log(
        `${cards.length} implemented cards, ${existing.length} already in lockfile, ` +
            `${missing.length} to fetch.`
    );
    if (graduated > 0) {
        console.log(
            `${graduated} compiled row(s) graduated to hand-written — cleared stale source tag.`
        );
    }
    if (pruned > 0) {
        console.log(
            `${pruned} pollution row(s) pruned (no CardDefinition behind them); ` +
                `every source: "compiled" row kept.`
        );
    }
    if (missing.length === 0) {
        if (graduated > 0 || pruned > 0) writeLock();
        console.log("Lockfile already complete.");
        return;
    }

    // Resumable: resolve in 75-id batches and persist the lockfile after EACH
    // batch. A blocked/killed run loses at most one batch; re-running skips
    // everything already written (matched by scryfallId above).
    let fetched = 0;
    // Cards whose FIRST-PRINTING lookup failed: no row was written for them
    // (issue #3423), and the run must not exit 0 over it.
    const unresolvedPrints: Array<{ id: string; name: string }> = [];
    for (let i = 0; i < missing.length; i += 75) {
        const chunk = missing.slice(i, i + 75);
        const batch = await resolveBatch(chunk.map((c) => c.id));
        const built = await buildEntriesForChunk(chunk, batch, (oracleId) =>
            resolveFirstPaperPrint(oracleId, {
                userAgent: "tolaria-backfill/1.0",
            })
        );
        for (const e of built.entries) byId.set(e.scryfallId, e);
        unresolvedPrints.push(...built.unresolvedPrints);
        writeLock();
        fetched += chunk.length;
        console.log(`  ${Math.min(fetched, missing.length)}/${missing.length}`);
    }

    const stillMissing = cards.filter((c) => !byId.has(c.id));
    console.log(`\nWrote ${byId.size} entries → ${lockPath}`);
    if (stillMissing.length) {
        console.warn(
            `\n${stillMissing.length} unresolved (no Scryfall match):`
        );
        for (const c of stillMissing) console.warn(`  - ${c.name} (${c.id})`);
    }
    if (unresolvedPrints.length) {
        // Non-zero exit, not a warning: nothing in this repo re-reads a
        // `console.warn`, which is how a fallback-written row went unnoticed
        // for a year (issue #3423).
        console.error(
            `\n✗ ${unresolvedPrints.length} card(s) left UNINDEXED — first-printing ` +
                `lookup failed (Scryfall unreachable / rate-limited). No row was ` +
                `written for them, rather than a guess that reads as verified:`
        );
        for (const c of unresolvedPrints)
            console.error(`  - ${c.name} (${c.id})`);
        console.error("Re-run the backfill once Scryfall answers again.");
        process.exitCode = 1;
    }
}

// Run only as a script, never on import (keeps `graduateCompiledEntries`'s
// unit test network-free — same pattern as `oracle-compile.ts`).
if (import.meta.main) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
