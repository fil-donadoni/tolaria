#!/usr/bin/env bun
/**
 * Drift guard for the lockfile `data/card-index.json` (ADR 0041).
 *
 * The lockfile is the committed index of every IMPLEMENTED card, and the only
 * thing `list-to-cards.mjs` dedups a worklist against. It must stay in sync
 * with the registry (`convex/cards/sets/<code>/*.ts` via `getAllCards()`):
 *
 *   - a card in the registry but MISSING from the lockfile  → the importer
 *     would re-stage an already-implemented card (stale lockfile).
 *   - a lockfile entry whose scryfallId is NOT in the registry → EXTRA /
 *     pollution: a staged-but-not-implemented card leaked in (the old
 *     importer used to write these back), poisoning future dedup.
 *
 * It ALSO enforces ADR 0041's "home set = earliest paper printing": a
 * `CardDefinition.id` must be the card's FIRST printing, never a reprint. A
 * card implemented against a reprint files itself under the wrong home set and
 * renders the wrong art — silent, and only ever caught by eye (Staff of the
 * Storyteller shipped against a 2026 SOC reprint of a 2023 ONC card). The
 * lockfile carries `firstPrintId` (resolved online by the backfill), so the
 * check stays offline: `scryfallId === firstPrintId` for every entry.
 *
 * It SUBSUMES the two MTGJSON-based id guards ADR 0041 set out to replace
 * (`check-scryfall-ids.mjs`, `card-id-scryfall.test.ts`, both now deleted):
 * each read `data/json/<SET>.json` for a hardcoded handful of sets, so a card
 * from an unvendored set was unguarded. An id that is not a real Scryfall print
 * id — an invented UUID, or an oracle id — resolves to nothing at Scryfall, so
 * the backfill never indexes it and it lands in `missing` here; an id that is a
 * real print but the WRONG one fails the `firstPrintId` check below. Both,
 * catalogue-wide, still offline.
 *
 * This check is OFFLINE (registry ⇄ lockfile id set comparison) so it can live
 * in `check:all`. The FIX is online — top up the lockfile from the registry:
 *
 *   bun run scripts/backfill-card-index.ts            # missing rows
 *   bun run scripts/backfill-card-index.ts --prune    # …and drop pollution
 *
 * The backfill is additive/idempotent, so plain runs only APPEND; `--prune`
 * is what removes an `extra`, using this file's own `isPollutionEntry` so the
 * two can never disagree.
 *
 * NEVER do this (banned-recipe: cited-to-forbid): `printf '[]\n' > data/card-index.json`
 * before the backfill. It does clear pollution,
 * but it also destroys the ~1400 `source: "compiled"` rows, which the backfill
 * cannot regenerate — they come from `oracle-index-backfill.ts` and its own
 * Scryfall pass. This hint used to say exactly that and cost a session a
 * silent 1429-row deletion.
 *
 * Run: bun scripts/check-card-index.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getAllCards } from "../convex/cards/index";
import { isPollutionEntry } from "./lib/card-index-pollution";

type Entry = {
    name: string;
    scryfallId: string;
    /** Earliest PAPER printing of this card (ADR 0041). Absent on entries
     *  written before the field existed — those are reported as needing a
     *  lockfile refresh rather than silently skipped. */
    firstPrintId?: string;
    firstPrintSet?: string;
    firstSet?: string;
    /** Present + `"compiled"` iff this row exists ONLY because the Oracle
     *  compiler reached `ready` for it (`scripts/oracle-index-backfill.ts`,
     *  issue #2702) — it has no `CardDefinition` in the hand-written registry
     *  to compare against, by construction (`convex/cards/compiledCatalogue.ts`
     *  hydrates it through a SEPARATE seam, `data/oracle-compiled-pool.json`).
     *  Excluded below from the "extra / pollution" check, which exists to
     *  catch a stale hand-written entry, not a compiled one. */
    source?: "compiled";
};

const lockPath = resolve("data/card-index.json");
if (!existsSync(lockPath)) {
    console.error(
        "✗ card-index: data/card-index.json is missing. Seed it with:\n" +
            "  bun run scripts/backfill-card-index.ts\n" +
            "(then `bun run oracle:index` to restore the compiled-sourced rows)"
    );
    process.exit(1);
}

const lock: Entry[] = JSON.parse(readFileSync(lockPath, "utf-8"));
const cards = getAllCards();

const lockIds = new Set(lock.map((e) => e.scryfallId));
const registryIds = new Set(cards.map((c) => c.id));

// implemented but not indexed → stale lockfile
const missing = cards.filter((c) => !lockIds.has(c.id));
// indexed but not implemented → pollution. A compiled-sourced row is
// EXPECTED to be absent from the hand-written registry (issue #2702) — it
// is real data, not pollution, so it is excluded here rather than counted.
const extra = lock.filter((e) => isPollutionEntry(e, registryIds));
// ADR 0041 — implemented against a reprint instead of the first printing.
const reprinted = lock.filter(
    (e) =>
        registryIds.has(e.scryfallId) &&
        e.firstPrintId !== undefined &&
        e.firstPrintId !== e.scryfallId
);
// Entries written before `firstPrintId` existed can't be checked at all.
const unversioned = lock.filter(
    (e) => registryIds.has(e.scryfallId) && e.firstPrintId === undefined
);

if (
    missing.length === 0 &&
    extra.length === 0 &&
    reprinted.length === 0 &&
    unversioned.length === 0
) {
    console.log(
        `✓ card-index: in sync, every card on its first printing (${cards.length} cards)`
    );
    process.exit(0);
}

if (reprinted.length) {
    console.error(
        `✗ card-index: ${reprinted.length} card(s) implemented against a REPRINT ` +
            `instead of their first printing (ADR 0041 — home set = earliest paper printing).\n` +
            `Move the definition to its home-set module, use the first-printing id, and\n` +
            `leave a \`CardPrint\` behind for the printing it was written against:\n`
    );
    for (const e of reprinted.slice(0, 30)) {
        console.error(
            `  - ${e.name}: uses ${e.firstSet ?? "?"} ${e.scryfallId}, ` +
                `first printed in ${e.firstPrintSet ?? "?"} ${e.firstPrintId}`
        );
    }
    if (reprinted.length > 30)
        console.error(`  … and ${reprinted.length - 30} more`);
    console.error("");
}

if (unversioned.length) {
    console.error(
        `✗ card-index: ${unversioned.length} entr(ies) predate the first-printing ` +
            `field, so ADR 0041 can't be checked for them. Delete just those rows ` +
            `and re-run the backfill to re-resolve them.\n`
    );
}

// `reprinted` and `unversioned` each printed their own targeted remedy above,
// and neither is an id-set mismatch: with only those firing, "0 missing, 0
// extra" plus a backfill hint is noise at best and misleading at worst — the
// backfill would find nothing to fetch, print "Lockfile already complete", and
// leave the check failing identically on the next run.
const outOfSync = missing.length > 0 || extra.length > 0;
if (outOfSync) {
    console.error(
        `✗ card-index: lockfile out of sync with the registry ` +
            `(${missing.length} missing, ${extra.length} extra)\n`
    );
    if (missing.length) {
        console.error(`MISSING from lockfile (implemented but not indexed):`);
        for (const c of missing.slice(0, 30))
            console.error(`  - ${c.name} (${c.id})`);
        if (missing.length > 30)
            console.error(`  … and ${missing.length - 30} more`);
        console.error("");
    }
    if (extra.length) {
        console.error(
            `EXTRA in lockfile (indexed but NOT implemented — pollution):`
        );
        for (const e of extra.slice(0, 30))
            console.error(`  - ${e.name} (${e.scryfallId})`);
        if (extra.length > 30)
            console.error(`  … and ${extra.length - 30} more`);
        console.error("");
    }
    // The fix depends on WHICH way the lockfile is out of sync. A plain backfill
    // only appends, so it cannot clear an `extra`; `--prune` clears exactly the
    // rows reported above. Resetting the file to `[]` first would clear them too —
    // and destroy every `source: "compiled"` row with them, which nothing here can
    // rebuild — so it is never the instruction.
    console.error(
        extra.length
            ? "Top up the lockfile and drop the pollution rows:\n" +
                  "  bun run scripts/backfill-card-index.ts --prune"
            : "Top up the lockfile from the registry:\n" +
                  "  bun run scripts/backfill-card-index.ts"
    );
}
process.exit(1);
