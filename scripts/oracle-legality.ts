#!/usr/bin/env bun
/**
 * `bun run oracle:legality` — extract per-format legality from the pinned
 * Oracle corpus into `data/oracle-legality.json` (issue #2695).
 *
 * ── Why this exists as its OWN artifact, not a lockfile field ─────────────
 *
 * `oracle-corpus.ts` already computes `legalIn` per corpus row (`:157`,
 * `legalities[f] === "legal"`), but `oracle-compile.ts` only reads it to fold
 * into AGGREGATE per-format counts (`formats.total/ready/quarantine/...`,
 * `:131-132`) and then discards the per-card detail — `CardRow` carries no
 * legality field. This script is the one place the per-card legality survives
 * past that fold, because `convex/formats.ts` needs to consume it directly
 * (deck legality, not compiler progress reporting).
 *
 * ── Why NAME-keyed, not oracle-id-keyed ────────────────────────────────────
 *
 * `CardDefinition` (`convex/cards/types.ts`) carries no oracle id — it is
 * identified by Tolaria's own minted UUID (its home printing's Scryfall
 * print id, NOT the oracle id). Joining this file to a deck's resolved card
 * therefore has to go through something both sides share: the card's NAME.
 * This repo already accepts a name-keyed join across the same id-space gap —
 * ADR 0057's DB-backed banlists resolve entries by name via `nameRegistry`
 * (`convex/cards/catalogue.ts`'s `tryGetCardByName`, `.toLowerCase()`-folded)
 * for exactly this reason. This file follows the same normalisation
 * convention so the two joins behave identically.
 *
 * (A more precise oracle-id join IS possible without touching
 * `CardDefinition` — `data/card-index.json`, ADR 0041's home-set backfill,
 * already carries `{ scryfallId (== CardDefinition.id), oracleId }` for
 * every built card. Left as a documented follow-up, not adopted here, to
 * avoid pulling a second ~600 KB generated file into the `formats.ts`
 * import graph — see the PR description / findings for the trade-off.)
 *
 * ── Collision handling ─────────────────────────────────────────────────────
 *
 * Two DIFFERENT oracle ids can share an exact name (38 cases in the
 * 2026-08-25 corpus of 34,890 rows — Un-set/joke-card printings and a small
 * number of Vanguard-adjacent objects that happen to share a name with a
 * real tournament card: "Inferno", "Cunning", "Bounty Hunter"). This script
 * takes the UNION per name: a name is recorded Premodern-legal when ANY
 * oracle id sharing it is. That is safe here specifically because Tolaria
 * only ever builds the REAL tournament card under a given name — the joke
 * duplicate has no `CardDefinition`, so the union can never legalise a card
 * this engine actually plays under a name that is only legal because of its
 * unbuilt namesake. A last-write-wins `Map.set` in corpus row order would be
 * the wrong alternative: it would make legality depend on Scryfall's
 * (unspecified, sort-order-dependent) row order instead of being a genuine
 * union.
 *
 * ── Pool membership, not "legal" (issue #2695 review, finding 3) ──────────
 *
 * The `premodern` array gates on `CorpusCard.poolIn` (legal OR banned OR
 * restricted), NOT `legalIn` (legal only). A card the DB banlist bans is
 * still IN this set — banning is `checkBanned`'s job (`convex/formats.ts`,
 * ADR 0057's DB sync), never this file's. Building the set from `legalIn`
 * alone would conflate "outside the pool" with "banned": every
 * `PREMODERN_BANLIST_SEED` name would then be absent from the map too, so
 * `checkOracleLegality` would enforce those bans a SECOND time, independently
 * of and on top of the injected/DB banlist — at which point an admin un-ban
 * (removing a row from the DB/seed) could no longer make the card legal
 * again without also re-pinning the corpus and shipping a code release,
 * exactly the toil PRD #1138/#1143 closed. Keeping this map to pool
 * membership only means a card's illegality reason is either
 * "outside the pool" (`premodern-illegal`, this file) or "banned"
 * (`checkBanned`, the banlist), never both at once for the same cause.
 *
 * ── Determinism ─────────────────────────────────────────────────────────
 *
 * Names are deduped case-insensitively (matching the lookup's own folding)
 * but stored in their ORIGINAL (first-seen, corpus-sorted-by-oracle-id)
 * casing, then sorted with a plain `<`/`>` comparator — never
 * `localeCompare`, which is ICU/locale-dependent and not guaranteed
 * byte-identical across machines (the same reason `oracle-compile.ts`'s
 * fragment table avoids it). Two runs against the same corpus are
 * byte-identical (`scripts/__tests__/oracle-legality.test.ts`).
 *
 * Usage:
 *   bun scripts/oracle-legality.ts            # regenerate the artifact
 *   bun scripts/oracle-legality.ts --check    # regenerate into memory and diff
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
    readCorpus,
    readPin,
    type CorpusCard,
    type CorpusPin,
} from "./oracle-corpus";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
export const LEGALITY_PATH = join(ROOT, "data", "oracle-legality.json");

// @2: `premodern` now gates on pool membership (legal ∪ banned ∪ restricted),
// not `legalIn` (legal only) — issue #2695 review finding 3 — and the file
// carries a `contentHash` self-check (finding 4). Both are schema/semantics
// changes over @1, hence the bump.
export const LEGALITY_GENERATOR = "oracle-legality@2";

/** The one format this ticket (#2695) consumes. Extending to the rest of
 *  `REPORTED_FORMATS` is straightforward (the corpus already carries every
 *  format's legality) but out of THIS ticket's scope — Premodern is the only
 *  format whose validator reads a generated legality map today. */
export interface OracleLegalityFile {
    readonly generator: string;
    /** The corpus pin this file was built from — lets a reader (and the
     *  drift guard) tell whether the committed artifact still matches the
     *  committed corpus pin without needing the corpus cache itself. */
    readonly corpus: CorpusPin;
    /**
     * sha256 of `JSON.stringify(premodern)` (see `legalityContentHash`). A
     * self-contained integrity check independent of the corpus cache (issue
     * #2695 review, finding 4): the `corpus` pin above proves the file
     * CLAIMS to come from a given Scryfall snapshot, but never confirms
     * `premodern[]` itself still matches that claim — a hand-edit (or a bad
     * merge-conflict resolution) that touches only the array passes the pin
     * check silently. This catches exactly that, on every checkout, corpus
     * cache present or not.
     */
    readonly contentHash: string;
    /** Card names (Scryfall `name`, original casing) that are Premodern POOL
     *  MEMBERS — `legalities.premodern` is `legal`, `banned` or `restricted`
     *  (never `not_legal`/absent) on at least one oracle id sharing the name.
     *  Deliberately NOT "legal only" — see the file header's "Pool
     *  membership, not legal" section. Sorted, deduped case-insensitively.
     *  Consumed by `checkOracleLegality` (`convex/formats.ts`) for POOL
     *  membership only; `checkBanned` remains the sole ban authority. */
    readonly premodern: readonly string[];
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Union-by-name (see file header). PURE — no I/O, so a fixture corpus (a
 * deliberately duplicated name, one legal one not) can prove the union
 * behaviour directly. Gates on `poolIn`, not `legalIn` — see the file
 * header's "Pool membership, not legal" section.
 */
export function buildPremodernLegalNames(
    corpus: readonly CorpusCard[]
): string[] {
    const byKey = new Map<string, string>(); // lower(name) -> original-cased name
    for (const card of corpus) {
        if (!card.poolIn.includes("premodern")) continue;
        const trimmed = card.name.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (!byKey.has(key)) byKey.set(key, trimmed);
    }
    return [...byKey.values()].sort(cmp);
}

/** sha256 hex digest of the exact JSON the `premodern` array serializes to.
 *  Pure and order-sensitive by design — `premodern` is already a fixed,
 *  sorted array, so two builds from the same logical set hash identically,
 *  and a hand-edit (add/remove/reorder a name) changes the digest. */
export function legalityContentHash(premodern: readonly string[]): string {
    return createHash("sha256").update(JSON.stringify(premodern)).digest("hex");
}

export function buildLegalityFile(
    corpus: readonly CorpusCard[],
    pin: CorpusPin
): OracleLegalityFile {
    const premodern = buildPremodernLegalNames(corpus);
    return {
        generator: LEGALITY_GENERATOR,
        corpus: pin,
        contentHash: legalityContentHash(premodern),
        premodern,
    };
}

/** Fixed key order + trailing newline, matching `serializeLockfile`'s
 *  convention — a stable byte shape is what makes the drift guard's diff
 *  meaningful. */
export function serializeLegalityFile(file: OracleLegalityFile): string {
    const ordered: OracleLegalityFile = {
        generator: file.generator,
        corpus: file.corpus,
        contentHash: file.contentHash,
        premodern: file.premodern,
    };
    return JSON.stringify(ordered, null, 4) + "\n";
}

async function main(): Promise<void> {
    const check = process.argv.includes("--check");
    const pin = readPin();
    if (pin === null) {
        throw new Error(
            "data/oracle-corpus.pin.json missing — run: bun run oracle:corpus"
        );
    }
    const text = serializeLegalityFile(buildLegalityFile(readCorpus(), pin));
    if (check) {
        const current = existsSync(LEGALITY_PATH)
            ? readFileSync(LEGALITY_PATH, "utf8")
            : "";
        if (current !== text) {
            process.stderr.write(
                "oracle:legality --check — data/oracle-legality.json is stale\n"
            );
            process.exit(1);
        }
        process.stderr.write("oracle:legality --check — up to date\n");
        return;
    }
    writeFileSync(LEGALITY_PATH, text);
    const parsed = JSON.parse(text) as OracleLegalityFile;
    process.stderr.write(
        `oracle:legality — ${parsed.premodern.length} Premodern-legal names -> data/oracle-legality.json\n`
    );
}

if (import.meta.main) {
    await main();
}
