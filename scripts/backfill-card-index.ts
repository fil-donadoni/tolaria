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

/** Printings that are never a card's "first edition": Scryfall set types that
 *  are not real releases. Digital-only printings are excluded separately via
 *  the `digital` flag (ADR 0041 excludes digital-only, gold-border, oversized
 *  and non-tournament printings). */
const NON_PRINT_SET_TYPES = new Set(["token", "memorabilia", "minigame"]);

const SCRYFALL = "https://api.scryfall.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Resolved = Map<
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

/** The card's earliest PAPER printing (ADR 0041). Only called for a print
 *  Scryfall marked as a reprint — otherwise the print in hand already is the
 *  first one. Falls back to the print in hand if the search fails or returns
 *  nothing usable, so a transient API problem never silently rewrites the
 *  lockfile to a wrong id. */
async function firstPaperPrint(
    oracleId: string,
    fallbackId: string,
    fallbackSet: string
): Promise<{ id: string; set: string }> {
    const url =
        `${SCRYFALL}/cards/search?order=released&dir=asc&unique=prints` +
        `&include_extras=true&q=${encodeURIComponent(`oracleid:${oracleId}`)}`;
    for (let a = 1; a <= 4; a++) {
        const res = await fetch(url, {
            headers: {
                Accept: "application/json",
                "User-Agent": "tolaria-backfill/1.0",
            },
        });
        await sleep(150);
        if (res.status === 429 || res.status >= 500) {
            await sleep(1500 * a);
            continue;
        }
        if (!res.ok) break;
        const json = (await res.json()) as {
            data: Array<{
                id: string;
                set: string;
                set_type: string;
                digital: boolean;
            }>;
        };
        const paper = json.data.filter(
            (p) => !p.digital && !NON_PRINT_SET_TYPES.has(p.set_type)
        );
        if (paper.length > 0) return { id: paper[0].id, set: paper[0].set };
        break;
    }
    console.warn(`  prints lookup failed for ${oracleId} — keeping own print`);
    return { id: fallbackId, set: fallbackSet };
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

async function main() {
    const lockPath = resolve("data/card-index.json");
    const existing: Entry[] = existsSync(lockPath)
        ? JSON.parse(readFileSync(lockPath, "utf-8"))
        : [];
    const byId = new Map(existing.map((e) => [e.scryfallId, e]));

    const cards = getAllCards();
    const registryScryfallIds = new Set(cards.map((c) => c.id));
    const graduated = graduateCompiledEntries(existing, registryScryfallIds);

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
    if (missing.length === 0) {
        if (graduated > 0) writeLock();
        console.log("Lockfile already complete.");
        return;
    }

    // Resumable: resolve in 75-id batches and persist the lockfile after EACH
    // batch. A blocked/killed run loses at most one batch; re-running skips
    // everything already written (matched by scryfallId above).
    let fetched = 0;
    for (let i = 0; i < missing.length; i += 75) {
        const chunk = missing.slice(i, i + 75);
        const batch = await resolveBatch(chunk.map((c) => c.id));
        for (const c of chunk) {
            const r = batch.get(c.id);
            if (!r) continue; // unresolved (bad id / not_found) — reported on re-run
            const first = r.reprint
                ? await firstPaperPrint(r.oracleId, c.id, r.set)
                : { id: c.id, set: r.set };
            byId.set(c.id, {
                name: c.name,
                scryfallId: c.id,
                oracleId: r.oracleId,
                firstSet: r.set,
                firstPrintId: first.id,
                firstPrintSet: first.set,
            });
        }
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
}

// Run only as a script, never on import (keeps `graduateCompiledEntries`'s
// unit test network-free — same pattern as `oracle-compile.ts`).
if (import.meta.main) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
