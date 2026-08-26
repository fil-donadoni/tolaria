#!/usr/bin/env bun
/**
 * Backfill compiled `ready` rows into `data/card-index.json` (ADR 0041 +
 * issue #2702).
 *
 * `scripts/backfill-card-index.ts` walks the HAND-WRITTEN registry
 * (`CardDefinition.id`, already a Scryfall print id) forward to its
 * `oracle_id`. The Oracle compiler's lockfile (`data/oracle-compiled.json`)
 * runs the opposite direction: a `ready` row carries only an `oracleId` (CR
 * text is a property of the oracle card, not of one printing — see
 * `scripts/oracle-corpus.ts`'s header), and the compiler is deliberately
 * forbidden from emitting `id`/`rarity` (`convex/oracle/types.ts` —
 * "printing/catalogue metadata no amount of grammar can derive from rules
 * text"). Both facts are documented in `docs/adr/0107-compiled-card-id-scheme.md`.
 *
 * This script closes that gap the same way `backfill-card-index.ts` closes
 * its own: resolve via Scryfall, pin the EARLIEST PAPER printing (ADR 0041),
 * write the result into the SAME `data/card-index.json` lockfile so a
 * compiled card's `id` and a hand-written card's `id` are computed by one
 * rule, in one committed artifact — "compiled ids join the index" (issue
 * #2702 acceptance criterion), not a second, parallel index.
 *
 * New entries are tagged `source: "compiled"` so `check-card-index.ts` can
 * tell them apart from the hand-written population its "pollution" check
 * polices (a compiled entry has no `CardDefinition` to compare against, by
 * construction — that would defeat the guard's own purpose).
 *
 * An oracle id already present (hand-written OR previously compiled) is
 * left untouched — a card compiled AND hand-written keeps the hand-written
 * entry, so the pool loader (`scripts/oracle-pool.ts`) can exclude it and
 * the hand-written definition stays sole authority (PRD #2693 "gold as
 * oracle"; retiring a hand-written card in favour of its compiled twin is
 * its own future PR, not a side effect of this backfill).
 *
 * Idempotent + resumable, exactly like `backfill-card-index.ts`: persists
 * after every batch, so a killed run loses at most one batch.
 *
 * Run:
 *   bun run oracle:index
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

type Rarity = "common" | "uncommon" | "rare" | "mythic";
const KNOWN_RARITIES: ReadonlySet<string> = new Set([
    "common",
    "uncommon",
    "rare",
    "mythic",
]);

interface Entry {
    name: string;
    scryfallId: string;
    oracleId: string;
    firstSet: string;
    firstPrintId: string;
    firstPrintSet: string;
    /** Rarity of `firstPrintId` (CR 206). Only ever populated for a
     *  `source: "compiled"` entry — a hand-written `CardDefinition` already
     *  declares its own rarity by hand, so its card-index row never needs
     *  one. */
    rarity?: Rarity;
    /** Present + `"compiled"` iff this row exists ONLY because the Oracle
     *  compiler reached `ready` for it — absent (the default) means
     *  hand-written, exactly as every row before this field existed. */
    source?: "compiled";
}

/** Printings that are never a card's "first edition" (mirrors
 *  `backfill-card-index.ts`). */
const NON_PRINT_SET_TYPES = new Set(["token", "memorabilia", "minigame"]);

const SCRYFALL = "https://api.scryfall.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type CollectionHit = {
    id: string;
    set: string;
    rarity: string;
    reprint: boolean;
};
type Resolved = Map<string, CollectionHit>;

async function postBatch(
    oracleIds: string[],
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
                    "User-Agent": "tolaria-oracle-index/1.0",
                },
                body: JSON.stringify({
                    identifiers: oracleIds.map((oracle_id) => ({ oracle_id })),
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
        if ((res.status === 429 || res.status >= 500) && a < attempts) {
            const retryAfter = Number(res.headers.get("retry-after")) || 0;
            await sleep(Math.max(retryAfter * 1000, 2000 * a));
            continue;
        }
        break;
    }
    await sleep(120);
    if (!res) throw new Error("Scryfall collection: no response");
    if (res.status === 400) return null;
    if (!res.ok) throw new Error(`Scryfall collection HTTP ${res.status}`);
    const json = (await res.json()) as {
        data: Array<{
            id: string;
            oracle_id: string;
            set: string;
            rarity: string;
            reprint?: boolean;
        }>;
    };
    const out: Resolved = new Map();
    for (const c of json.data)
        out.set(c.oracle_id, {
            id: c.id,
            set: c.set,
            rarity: c.rarity,
            reprint: c.reprint === true,
        });
    return out;
}

async function resolveBatch(oracleIds: string[]): Promise<Resolved> {
    const ok = await postBatch(oracleIds);
    if (ok) return ok;
    if (oracleIds.length === 1) {
        console.warn(`  rejected by Scryfall (skipped): ${oracleIds[0]}`);
        return new Map();
    }
    const mid = Math.floor(oracleIds.length / 2);
    const left = await resolveBatch(oracleIds.slice(0, mid));
    const right = await resolveBatch(oracleIds.slice(mid));
    return new Map([...left, ...right]);
}

/** The card's earliest PAPER printing (ADR 0041) — same method as
 *  `backfill-card-index.ts`'s `firstPaperPrint`, plus `rarity` (that file
 *  never needed it: a hand-written `CardDefinition` already declares its
 *  own). */
async function firstPaperPrint(
    oracleId: string,
    fallback: { id: string; set: string; rarity: string }
): Promise<{ id: string; set: string; rarity: string }> {
    const url =
        `${SCRYFALL}/cards/search?order=released&dir=asc&unique=prints` +
        `&include_extras=true&q=${encodeURIComponent(`oracleid:${oracleId}`)}`;
    for (let a = 1; a <= 4; a++) {
        const res = await fetch(url, {
            headers: {
                Accept: "application/json",
                "User-Agent": "tolaria-oracle-index/1.0",
            },
        });
        await sleep(120);
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
                rarity: string;
            }>;
        };
        const paper = json.data.filter(
            (p) => !p.digital && !NON_PRINT_SET_TYPES.has(p.set_type)
        );
        if (paper.length > 0)
            return {
                id: paper[0].id,
                set: paper[0].set,
                rarity: paper[0].rarity,
            };
        break;
    }
    console.warn(`  prints lookup failed for ${oracleId} — keeping own print`);
    return fallback;
}

interface ReadyRow {
    oracleId: string;
    name: string;
    state: string;
}

async function main() {
    const lockPath = resolve("data/card-index.json");
    const existing: Entry[] = existsSync(lockPath)
        ? JSON.parse(readFileSync(lockPath, "utf-8"))
        : [];
    const byOracleId = new Map(existing.map((e) => [e.oracleId, e]));

    const lockfilePath = resolve("data/oracle-compiled.json");
    const lockfile = JSON.parse(readFileSync(lockfilePath, "utf-8")) as {
        cards: ReadyRow[];
    };
    const ready = lockfile.cards.filter((c) => c.state === "ready");
    const missing = ready.filter((c) => !byOracleId.has(c.oracleId));
    console.log(
        `${ready.length} compiled ready row(s), ${existing.length} card-index entries, ` +
            `${missing.length} to resolve.`
    );
    if (missing.length === 0) {
        console.log("card-index already covers every ready row.");
        return;
    }

    const writeLock = () => {
        const merged = [...byOracleId.values()].sort((a, b) =>
            a.name.localeCompare(b.name)
        );
        writeFileSync(
            lockPath,
            JSON.stringify(merged, null, 4) + "\n",
            "utf-8"
        );
    };

    let done = 0;
    let skippedRarity = 0;
    for (let i = 0; i < missing.length; i += 75) {
        const chunk = missing.slice(i, i + 75);
        const batch = await resolveBatch(chunk.map((c) => c.oracleId));
        for (const c of chunk) {
            const r = batch.get(c.oracleId);
            if (!r) continue; // unresolved — reported on re-run
            const first = r.reprint
                ? await firstPaperPrint(c.oracleId, r)
                : { id: r.id, set: r.set, rarity: r.rarity };
            if (!KNOWN_RARITIES.has(first.rarity)) {
                // "special" / "bonus" — unmodelled (convex/cards/types.ts
                // `Rarity`); bail loudly rather than coerce, same policy as
                // the import tool for hand-written cards.
                console.warn(
                    `  skipping ${c.name}: unmodelled rarity "${first.rarity}"`
                );
                skippedRarity++;
                continue;
            }
            byOracleId.set(c.oracleId, {
                name: c.name,
                scryfallId: first.id,
                oracleId: c.oracleId,
                firstSet: first.set,
                firstPrintId: first.id,
                firstPrintSet: first.set,
                rarity: first.rarity as Rarity,
                source: "compiled",
            });
        }
        writeLock();
        done += chunk.length;
        console.log(`  ${Math.min(done, missing.length)}/${missing.length}`);
    }

    const stillMissing = ready.filter((c) => !byOracleId.has(c.oracleId));
    console.log(`\nWrote ${byOracleId.size} total card-index entries.`);
    if (skippedRarity)
        console.warn(`${skippedRarity} skipped (unmodelled rarity).`);
    if (stillMissing.length) {
        console.warn(`${stillMissing.length} unresolved (no Scryfall match):`);
        for (const c of stillMissing.slice(0, 30))
            console.warn(`  - ${c.name} (${c.oracleId})`);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
