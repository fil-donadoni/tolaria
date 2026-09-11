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
 * text"). Both facts are documented in `docs/adr/0108-compiled-card-id-scheme.md`.
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
 * entry, so the catalogue merge (`scripts/catalogue-artifact.ts`) can exclude it and
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
// Fail-closed first-printing resolver, shared with `backfill-card-index.ts`
// (issue #3423). `null` means "Scryfall could not answer" — never a guess.
import {
    SCRYFALL,
    resolveFirstPaperPrint,
    type PaperPrint,
} from "./lib/first-paper-print";

type Rarity = "common" | "uncommon" | "rare" | "mythic";
const KNOWN_RARITIES: ReadonlySet<string> = new Set([
    "common",
    "uncommon",
    "rare",
    "mythic",
]);

export interface Entry {
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type CollectionHit = {
    id: string;
    set: string;
    rarity: string;
    reprint: boolean;
};
export type Resolved = Map<string, CollectionHit>;

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

interface ReadyRow {
    oracleId: string;
    name: string;
    state: string;
}

/** Build one chunk's worth of compiled lockfile rows from the collection
 *  lookup plus a first-printing RESOLVER, reporting both kinds of drop-out:
 *  a rarity this repo does not model, and a first-printing lookup the
 *  resolver could not answer.
 *
 *  A card whose prints lookup fails gets NO ROW (issue #3423). The old code
 *  fell back to the print in hand and wrote it into BOTH `scryfallId` and
 *  `firstPrintId` — the exact pair `check-card-index.ts` compares against
 *  each other, so the guess was verified-looking by construction. That is how
 *  Shadowblood Ridge shipped pinned to `dsc` (2024) instead of `ody` (2001).
 *
 *  Exported so that contract is testable without the network. */
export async function buildCompiledEntriesForChunk(
    chunk: ReadonlyArray<{ oracleId: string; name: string }>,
    batch: Resolved,
    resolvePrint: (oracleId: string) => Promise<PaperPrint | null>
): Promise<{
    entries: Entry[];
    skippedRarity: Array<{ name: string; rarity: string }>;
    unresolvedPrints: Array<{ oracleId: string; name: string }>;
}> {
    const entries: Entry[] = [];
    const skippedRarity: Array<{ name: string; rarity: string }> = [];
    const unresolvedPrints: Array<{ oracleId: string; name: string }> = [];
    for (const c of chunk) {
        const r = batch.get(c.oracleId);
        if (!r) continue; // unresolved — reported on re-run
        const first = r.reprint
            ? await resolvePrint(c.oracleId)
            : { id: r.id, set: r.set, rarity: r.rarity };
        if (!first) {
            unresolvedPrints.push({ oracleId: c.oracleId, name: c.name });
            continue;
        }
        if (!KNOWN_RARITIES.has(first.rarity)) {
            // "special" / "bonus" — unmodelled (convex/cards/types.ts
            // `Rarity`); bail loudly rather than coerce, same policy as
            // the import tool for hand-written cards.
            skippedRarity.push({ name: c.name, rarity: first.rarity });
            continue;
        }
        entries.push({
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
    return { entries, skippedRarity, unresolvedPrints };
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
    // Cards whose FIRST-PRINTING lookup failed: no row was written for them
    // (issue #3423), and the run must not exit 0 over it.
    const unresolvedPrints: Array<{ oracleId: string; name: string }> = [];
    for (let i = 0; i < missing.length; i += 75) {
        const chunk = missing.slice(i, i + 75);
        const batch = await resolveBatch(chunk.map((c) => c.oracleId));
        const built = await buildCompiledEntriesForChunk(
            chunk,
            batch,
            (oracleId) =>
                resolveFirstPaperPrint(oracleId, {
                    userAgent: "tolaria-oracle-index/1.0",
                })
        );
        for (const e of built.entries) byOracleId.set(e.oracleId, e);
        for (const s of built.skippedRarity)
            console.warn(
                `  skipping ${s.name}: unmodelled rarity "${s.rarity}"`
            );
        skippedRarity += built.skippedRarity.length;
        unresolvedPrints.push(...built.unresolvedPrints);
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
            console.error(`  - ${c.name} (${c.oracleId})`);
        console.error(
            "Re-run `bun run oracle:index` once Scryfall answers again."
        );
        process.exitCode = 1;
    }
}

// Run only as a script, never on import — `buildCompiledEntriesForChunk` has
// a network-free unit test (issue #3423), and importing this module used to
// fire the whole Scryfall pass.
if (import.meta.main) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
