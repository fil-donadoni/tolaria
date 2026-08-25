#!/usr/bin/env bun
/**
 * Oracle corpus cache — the pinned Scryfall `oracle_cards` bulk, reduced to the
 * fields the Oracle compiler reads, plus the format legalities the report needs.
 *
 * Usage:
 *   bun scripts/oracle-corpus.ts            # ensure (no-op when a usable cache exists)
 *   bun scripts/oracle-corpus.ts --force    # re-download and re-pin
 *
 * Output:
 *   data/oracle-corpus.json.gz  — the cache. GITIGNORED: it is ~30 MB of
 *                                 third-party data that changes weekly, and the
 *                                 repo's source of truth is the LOCKFILE it
 *                                 produces (`data/oracle-compiled.json`), not
 *                                 the input it was produced from.
 *   data/oracle-corpus.pin.json — COMMITTED. Records the exact bulk object the
 *                                 cache came from (uri, Scryfall's own
 *                                 `updated_at`, row count, sha256 of the
 *                                 reduced payload) so two reports are
 *                                 comparable and the lockfile header can name
 *                                 its input without shipping it.
 *
 * ── Why `oracle_cards` and not `default_cards` ─────────────────────────────
 *
 * `scripts/fetch-full-catalogue.mjs` deliberately takes `default_cards`, one
 * row per PRINTING, because it needs paper-ness and art, and Scryfall's chosen
 * representative printing can be digital-only.
 *
 * This file wants the opposite: one row per ORACLE ID, because the compiler
 * compiles rules text and rules text is a property of the oracle card, not of
 * a printing. Compiling 90k printings of 32k cards would be 3x the work for
 * byte-identical output, and the lockfile is keyed by `oracle_id`. Digital-only
 * representatives do not matter here — a card's Oracle text is the same
 * whichever printing Scryfall picks.
 */

import { createGunzip } from "node:zlib";
import { gzipSync, gunzipSync } from "node:zlib";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import {
    existsSync,
    mkdirSync,
    readFileSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
export const CORPUS_PATH = join(ROOT, "data", "oracle-corpus.json.gz");
export const PIN_PATH = join(ROOT, "data", "oracle-corpus.pin.json");

const BULK_INDEX = "https://api.scryfall.com/bulk-data/oracle-cards";
const HEADERS = {
    // Scryfall 400s on a default HTTP-library User-Agent; see fetch-full-catalogue.mjs.
    "User-Agent": "tolaria-oracle-corpus/1.0",
    Accept: "*/*",
};
const MIN_PLAUSIBLE_BYTES = 1_000_000;

/** The formats the per-format report covers. Premodern first — it is M1. */
export const REPORTED_FORMATS = [
    "premodern",
    "pauper",
    "modern",
    "legacy",
    "vintage",
    "commander",
] as const;
export type ReportedFormat = (typeof REPORTED_FORMATS)[number];

/** One face of a multi-faced card, as the compiler reads it. */
export interface CorpusFace {
    name: string;
    manaCost: string;
    typeLine: string;
    oracleText: string;
    power?: string;
    toughness?: string;
    loyalty?: string;
}

/** A corpus row: exactly the fields the compiler and the report read. */
export interface CorpusCard extends CorpusFace {
    oracleId: string;
    layout: string;
    /** Formats (of REPORTED_FORMATS) in which this oracle id is legal. */
    legalIn: ReportedFormat[];
    /**
     * Formats in which this oracle id is a POOL MEMBER — Scryfall
     * `legalities[format]` is `legal`, `banned` or `restricted`, as opposed
     * to `not_legal`/absent (the format simply does not support the card at
     * all — e.g. a card printed after Scourge, for Premodern).
     *
     * Deliberately INCLUDES banned/restricted cards, unlike `legalIn` — a
     * generated legality artifact built from `legalIn` alone conflates "not
     * in the pool" with "banned", which means a banlist can only ever ADD a
     * ban (removing one needs a corpus re-pin + code release, since the name
     * would still be absent from the map). Pool membership and ban status
     * are orthogonal questions; `checkBanned` (`convex/formats.ts`) is the
     * sole, overridable authority on the latter (issue #2695 review finding
     * 3, ADR 0057).
     */
    poolIn: ReportedFormat[];
    faces?: CorpusFace[];
}

export interface CorpusPin {
    source: string;
    downloadUri: string;
    /** Scryfall's own `updated_at` for the bulk object — the corpus DATE. */
    updatedAt: string;
    cardCount: number;
    /** sha256 of the reduced payload, so the pin identifies the exact bytes. */
    sha256: string;
}

function reduceFace(raw: Record<string, unknown>): CorpusFace {
    const face: CorpusFace = {
        name: String(raw.name ?? ""),
        manaCost: String(raw.mana_cost ?? ""),
        typeLine: String(raw.type_line ?? ""),
        oracleText: String(raw.oracle_text ?? ""),
    };
    if (raw.power !== undefined) face.power = String(raw.power);
    if (raw.toughness !== undefined) face.toughness = String(raw.toughness);
    if (raw.loyalty !== undefined) face.loyalty = String(raw.loyalty);
    return face;
}

/**
 * Scryfall's `oracle_cards` bulk is one row per oracle id of every OBJECT it
 * tracks, which includes things that are not cards: art series, tokens,
 * emblems, and the Vanguard/Scheme/Plane supplements. Left in, they are 2,500+
 * permanent `unparsed` rows whose "rules text" is `"Card // Card"` — noise at
 * the top of the fragment backlog, which is the one place the report is
 * supposed to be signal.
 *
 * `scripts/fetch-full-catalogue.mjs` excludes the same layouts for the same
 * reason (ADR 0080).
 *
 * What is deliberately NOT filtered here is paper-ness. That file's header
 * explains why it cannot be: an `oracle_cards` row is ONE representative
 * printing chosen by Scryfall, and a real card's representative can be
 * digital-only (Mox Diamond's is MTGO Tempest Remastered). Filtering these rows
 * on `games.includes("paper")` therefore asks "did Scryfall happen to pick a
 * paper printing", not "does this card exist on paper" — measured here at 702
 * Premodern-legal cards wrongly dropped (5,375 -> 4,673, against PRD #2693's
 * 5,375 baseline). Paper-ness is observable on `default_cards`, which is why
 * the catalogue fetcher uses it and this one does not.
 */
const EXCLUDED_LAYOUTS = new Set([
    "art_series",
    "token",
    "double_faced_token",
    "emblem",
    "vanguard",
    "scheme",
    "planar",
]);

// Scryfall's four legality values (API docs): "legal", "not_legal",
// "restricted", "banned". Pool membership (`CorpusCard.poolIn`) is everything
// except "not_legal"/absent.
const IN_POOL = new Set(["legal", "banned", "restricted"]);

function reduceCard(raw: Record<string, unknown>): CorpusCard | null {
    const oracleId = raw.oracle_id;
    if (typeof oracleId !== "string" || oracleId.length === 0) return null;
    if (EXCLUDED_LAYOUTS.has(String(raw.layout ?? "normal"))) return null;
    const legalities = (raw.legalities ?? {}) as Record<string, string>;
    const card: CorpusCard = {
        ...reduceFace(raw),
        oracleId,
        layout: String(raw.layout ?? "normal"),
        legalIn: REPORTED_FORMATS.filter((f) => legalities[f] === "legal"),
        poolIn: REPORTED_FORMATS.filter((f) => IN_POOL.has(legalities[f])),
    };
    const faces = raw.card_faces;
    if (Array.isArray(faces) && faces.length > 0) {
        card.faces = faces.map((f) => reduceFace(f as Record<string, unknown>));
    }
    return card;
}

async function download(): Promise<{
    cards: CorpusCard[];
    pin: Omit<CorpusPin, "sha256">;
}> {
    const indexRes = await fetch(BULK_INDEX, { headers: HEADERS });
    if (!indexRes.ok) throw new Error(`Scryfall bulk index ${indexRes.status}`);
    const meta = (await indexRes.json()) as Record<string, unknown>;
    // Scryfall now serves `jsonl_download_uri` (gzipped JSONL) and has dropped
    // `download_uri` from the oracle-cards object; keep the legacy key as a
    // fallback rather than assuming either is present.
    const uri = (meta.jsonl_download_uri ?? meta.download_uri ?? "") as string;
    if (!uri) throw new Error("Scryfall bulk index returned no download uri");
    const updatedAt = String(meta.updated_at ?? "");

    process.stderr.write(`oracle-corpus: downloading ${uri}\n`);
    const res = await fetch(uri, { headers: HEADERS });
    if (!res.ok || !res.body)
        throw new Error(`Scryfall bulk download ${res.status}`);

    const cards: CorpusCard[] = [];
    if (uri.endsWith(".jsonl") || uri.endsWith(".jsonl.gz")) {
        const stream = uri.endsWith(".gz")
            ? Readable.fromWeb(res.body as never).pipe(createGunzip())
            : Readable.fromWeb(res.body as never);
        for await (const line of createInterface({
            input: stream,
            crlfDelay: Infinity,
        })) {
            if (!line.trim()) continue;
            const reduced = reduceCard(JSON.parse(line));
            if (reduced) cards.push(reduced);
        }
    } else {
        const raw = JSON.parse(await res.text()) as Record<string, unknown>[];
        for (const entry of raw) {
            const reduced = reduceCard(entry);
            if (reduced) cards.push(reduced);
        }
    }

    // Deterministic order: the compiler's output must not depend on Scryfall's.
    cards.sort((a, b) =>
        a.oracleId < b.oracleId ? -1 : a.oracleId > b.oracleId ? 1 : 0
    );
    return {
        cards,
        pin: {
            source: BULK_INDEX,
            downloadUri: uri,
            updatedAt,
            cardCount: cards.length,
        },
    };
}

export function readCorpus(): CorpusCard[] {
    if (!existsSync(CORPUS_PATH)) {
        throw new Error(
            `oracle corpus cache missing (${CORPUS_PATH}) — run: bun run oracle:corpus`
        );
    }
    return JSON.parse(
        gunzipSync(readFileSync(CORPUS_PATH)).toString("utf8")
    ) as CorpusCard[];
}

export function readPin(): CorpusPin | null {
    if (!existsSync(PIN_PATH)) return null;
    return JSON.parse(readFileSync(PIN_PATH, "utf8")) as CorpusPin;
}

export function corpusIsCached(): boolean {
    return (
        existsSync(CORPUS_PATH) &&
        statSync(CORPUS_PATH).size >= MIN_PLAUSIBLE_BYTES
    );
}

async function main(): Promise<void> {
    const force = process.argv.includes("--force");
    if (!force && corpusIsCached() && readPin()) {
        process.stderr.write(`oracle-corpus: cache present (${CORPUS_PATH})\n`);
        return;
    }
    const { cards, pin } = await download();
    const payload = JSON.stringify(cards);
    const sha256 = createHash("sha256").update(payload).digest("hex");
    mkdirSync(dirname(CORPUS_PATH), { recursive: true });
    writeFileSync(
        CORPUS_PATH,
        gzipSync(Buffer.from(payload, "utf8"), { level: 9 })
    );
    writeFileSync(PIN_PATH, JSON.stringify({ ...pin, sha256 }, null, 4) + "\n");
    process.stderr.write(
        `oracle-corpus: ${cards.length} cards → ${CORPUS_PATH} (updated_at ${pin.updatedAt})\n`
    );
}

if (import.meta.main) {
    await main();
}
