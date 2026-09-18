#!/usr/bin/env bun
/**
 * `bun run metagame:import` — a pinned mtgtop8 import of the current Premodern
 * metagame: one decklist per archetype, for the 25 archetypes the owner named
 * (2026-09-17) as "the premodern metagame" (issue #3855, wayfinder map #3846).
 *
 * Same discipline as `data/premodern-tier1-decks.json` and the Scryfall corpus
 * pin (`scripts/oracle-corpus.ts`): a file plus a pin, never a fetch at report
 * time. `bun run oracle:report --decks` reads the two COMMITTED artefacts this
 * script writes — it never touches the network.
 *
 * Usage:
 *   bun scripts/premodern-metagame-import.ts             # no-op if pinned
 *   bun scripts/premodern-metagame-import.ts --refresh    # re-fetch, re-pin
 *
 * Output:
 *   data/premodern-metagame-decks.json     — COMMITTED. One card list per
 *                                            archetype, same shape as the
 *                                            Tier 1 file (`Tier1Deck`).
 *   data/premodern-metagame-decks.pin.json — COMMITTED. Provenance per
 *                                            archetype: archetype id, deck id,
 *                                            event id, player, placement,
 *                                            date and fetch timestamp — so a
 *                                            re-run is a diff a reviewer can
 *                                            read, not a black box.
 *
 * ── Picking ONE list per archetype ──────────────────────────────────────
 *
 * The owner's rule: the most recent TOP-8 placement within the last 12
 * months. mtgtop8's own "Last 2 Weeks" window (`meta=301`, the id the format
 * page `https://mtgtop8.com/format?f=PREM&meta=301` itself is pinned to) is
 * too narrow for a lightly-played archetype to have a top-8 finish in it at
 * all — Terrageddon (archetype 1487) has ZERO results there as of this
 * writing. So this script widens per-archetype to the two full-calendar-year
 * windows mtgtop8 offers ("All <year> Decks") that together cover any
 * trailing 365-day window, merges their rows, and picks the most recent
 * top-8 finish — falling back to the next-most-recent candidate if a chosen
 * deck's export does not parse to the required 60 + 15 (a handful of MTGO
 * league reports are truncated on mtgtop8's own pages).
 *
 * Card names are normalised to Scryfall's oracle `name` — for a split/DFC
 * card that is the COMBINED `Front // Back` (verified against
 * `data/oracle-compiled.json`: there is no standalone front-face row, e.g.
 * "Fire // Ice", never "Fire"), not the front face alone.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
    totalCopies,
    validateDecks,
    TIER1_MAIN_SIZE,
    TIER1_SIDEBOARD_SIZE,
    type Tier1Deck,
    type Tier1DeckEntry,
} from "./lib/tier1-decks";
import { parseLockfile, type Lockfile } from "./lib/oracle-lockfile";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
export const METAGAME_DECKS_PATH = join(
    ROOT,
    "data",
    "premodern-metagame-decks.json"
);
export const METAGAME_PIN_PATH = join(
    ROOT,
    "data",
    "premodern-metagame-decks.pin.json"
);

const HEADERS = {
    // mtgtop8 does not 400 on a generic UA the way Scryfall does, but a named
    // one is the polite baseline (see scripts/oracle-corpus.ts).
    "User-Agent": "tolaria-premodern-metagame-import/1.0",
};
const REQUEST_DELAY_MS = 400;
const TOP8_MAX = 8;
const WINDOW_DAYS = 365;

/**
 * mtgtop8's own "All <year> Decks" period id, read from the archetype page's
 * period selector. Not derivable — it is a raw site id — so this is the one
 * thing a future year needs added by hand; the script fails closed (§ below)
 * rather than silently narrowing the window when a year is missing.
 */
const YEAR_META: Readonly<Record<number, number>> = {
    2021: 255,
    2022: 256,
    2023: 257,
    2024: 284,
    2025: 309,
    2026: 345,
};

/**
 * The 25 archetypes the owner named (issue #3855): the 6 Tier 1 lists already
 * in `data/premodern-tier1-decks.json`, the 3 shipped presets, and the 16
 * named in the issue. Slugs for the 9 overlapping entries match those files
 * exactly, so a reader can join "this archetype's current metagame list" to
 * "this archetype's hand-curated Tier 1 list / shipped preset" by slug alone.
 */
export const ARCHETYPES: readonly {
    readonly slug: string;
    readonly name: string;
    readonly archetypeId: number;
}[] = [
    { slug: "goblin", name: "Goblins", archetypeId: 1479 },
    { slug: "psychatog", name: "Psychatog", archetypeId: 1485 },
    { slug: "parallax-replenish", name: "Replenish", archetypeId: 1476 },
    { slug: "landstill", name: "Landstill", archetypeId: 1473 },
    { slug: "oath-ponza", name: "Oath of Druids", archetypeId: 1486 },
    { slug: "aluren", name: "Aluren", archetypeId: 1489 },
    { slug: "deck-1", name: "Stiflenought", archetypeId: 1495 },
    { slug: "burn", name: "Sligh/Burn", archetypeId: 1472 },
    { slug: "enchantress", name: "Enchantress", archetypeId: 1481 },
    { slug: "rg-aggro", name: "RG Aggro", archetypeId: 1694 },
    { slug: "mono-black-aggro", name: "Mono Black Aggro", archetypeId: 1500 },
    {
        slug: "madness-threshold",
        name: "Madness/Threshold",
        archetypeId: 1477,
    },
    { slug: "elves", name: "Elves", archetypeId: 1475 },
    { slug: "the-rock", name: "The Rock", archetypeId: 1478 },
    { slug: "survival", name: "Survival", archetypeId: 1483 },
    { slug: "stasis", name: "Stasis", archetypeId: 1491 },
    {
        slug: "full-english-breakfast",
        name: "Full English Breakfast",
        archetypeId: 1484,
    },
    { slug: "grow", name: "Grow", archetypeId: 1515 },
    { slug: "angry-ghoul", name: "Angry Ghoul", archetypeId: 1516 },
    { slug: "doomsday", name: "Doomsday", archetypeId: 1492 },
    { slug: "reanimator", name: "Reanimator", archetypeId: 1493 },
    { slug: "stompy", name: "Stompy", archetypeId: 1498 },
    {
        slug: "zombie-infestation-aggro",
        name: "Zombie Infestation Aggro",
        archetypeId: 2811,
    },
    { slug: "terrageddon", name: "Terrageddon", archetypeId: 1487 },
    {
        slug: "mono-black-control",
        name: "Mono Black Control",
        archetypeId: 1496,
    },
] as const;

export interface MetagamePinEntry {
    readonly slug: string;
    readonly archetypeId: number;
    readonly eventId: number;
    readonly deckId: number;
    readonly player: string;
    readonly placement: string;
    /** ISO `yyyy-mm-dd`, as mtgtop8 reports it (event date, not fetch date). */
    readonly date: string;
    readonly fetchedAt: string;
}

export interface MetagamePin {
    readonly source: string;
    readonly format: string;
    readonly fetchedAt: string;
    readonly decks: readonly MetagamePinEntry[];
}

export interface MetagameDeckFile {
    readonly source: {
        readonly supplier: string;
        readonly format: string;
        readonly note: string;
    };
    readonly decks: readonly Tier1Deck[];
}

function fail(path: string, message: string): never {
    throw new Error(`${path}: ${message}`);
}

/** Parse and VALIDATE the metagame file — same 60 + 15 discipline as Tier 1. */
export function parseMetagameDecks(
    text: string,
    path = METAGAME_DECKS_PATH
): MetagameDeckFile {
    let doc: MetagameDeckFile;
    try {
        doc = JSON.parse(text) as MetagameDeckFile;
    } catch (err) {
        throw new Error(`${path} does not parse: ${(err as Error).message}`);
    }
    validateDecks(doc.decks, path);
    return doc;
}

export function readMetagameDecks(root: string): MetagameDeckFile {
    const path = join(root, "data", "premodern-metagame-decks.json");
    return parseMetagameDecks(readFileSync(path, "utf8"), path);
}

/** Parse and VALIDATE the pin — one entry per archetype, no duplicates. */
export function parseMetagamePin(
    text: string,
    path = METAGAME_PIN_PATH
): MetagamePin {
    let doc: MetagamePin;
    try {
        doc = JSON.parse(text) as MetagamePin;
    } catch (err) {
        throw new Error(`${path} does not parse: ${(err as Error).message}`);
    }
    if (!Array.isArray(doc.decks) || doc.decks.length === 0)
        fail(path, "no pin entries — the metagame import is missing");
    const archetypeIds = new Set<number>();
    for (const entry of doc.decks) {
        if (archetypeIds.has(entry.archetypeId))
            fail(
                path,
                `archetype ${entry.archetypeId} is pinned twice — one list per archetype`
            );
        archetypeIds.add(entry.archetypeId);
    }
    return doc;
}

export function readMetagamePin(root: string): MetagamePin {
    const path = join(root, "data", "premodern-metagame-decks.pin.json");
    return parseMetagamePin(readFileSync(path, "utf8"), path);
}

// ── Fetching ────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function politeFetch(url: string): Promise<string> {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const text = await res.text();
    await sleep(REQUEST_DELAY_MS);
    return text;
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
};

function unescapeHtml(text: string): string {
    return text.replace(
        /&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g,
        (m) => HTML_ENTITIES[m] ?? m
    );
}

interface CandidateRow {
    readonly deckId: number;
    readonly eventId: number;
    readonly player: string;
    readonly placement: string;
    /** ISO `yyyy-mm-dd`. */
    readonly date: string;
}

/**
 * One archetype-page result row. mtgtop8 renders each as a fixed 7-`<td>`
 * `<tr class=hover_tr>` — checkbox+deck id, event link (carries the deck id
 * too), player, event name, star rating, placement, date (`dd/mm/yy`).
 */
const ROW_RE =
    /<tr class=hover_tr>\s*<td><input type=checkbox name=deck_check\[\d+\] value=1 checked><input type=hidden name=deck_ref\[\d+\] value=(\d+)><\/td>\s*<td><a href=\/event\?e=(\d+)&d=\d+&f=PREM>[^<]*<\/a><\/td>\s*<td><a class=player href=\/search\?player=[^>]*>([^<]*)<\/a><\/td>\s*<td><a href=\/event\?e=\d+&f=PREM>[^<]*<\/a><\/td>\s*<td class=O16>.*?<\/td>\s*<td>([^<]*)<\/td>\s*<td>(\d{2})\/(\d{2})\/(\d{2})<\/td>\s*<\/tr>/gs;

function parseArchetypeRows(html: string): CandidateRow[] {
    const rows: CandidateRow[] = [];
    for (const m of html.matchAll(ROW_RE)) {
        rows.push({
            deckId: Number(m[1]),
            eventId: Number(m[2]),
            player: unescapeHtml(m[3]!),
            placement: m[4]!,
            date: `20${m[7]}-${m[6]}-${m[5]}`,
        });
    }
    return rows;
}

/** A placement string ("1", "3-4", "5-8", "17-32") is top-8 iff its worst
 *  (highest) number is <= 8. */
function isTop8(placement: string): boolean {
    const numbers = placement.match(/\d+/g);
    if (numbers === null) return false;
    return Math.max(...numbers.map(Number)) <= TOP8_MAX;
}

async function fetchArchetypeRows(
    archetypeId: number,
    year: number
): Promise<CandidateRow[]> {
    const metaId = YEAR_META[year];
    if (metaId === undefined)
        throw new Error(
            `no mtgtop8 "All ${year} Decks" period id pinned in YEAR_META — ` +
                `look it up on an archetype page's period selector and add it`
        );
    const html = await politeFetch(
        `https://mtgtop8.com/archetype?a=${archetypeId}&meta=${metaId}&f=PREM`
    );
    return parseArchetypeRows(html);
}

/** Every top-8 candidate within the last `WINDOW_DAYS`, most recent first. */
async function pickCandidates(
    archetypeId: number,
    today: Date
): Promise<CandidateRow[]> {
    const years = [today.getUTCFullYear(), today.getUTCFullYear() - 1];
    const rows: CandidateRow[] = [];
    for (const year of years) {
        rows.push(...(await fetchArchetypeRows(archetypeId, year)));
    }
    const cutoff = new Date(today);
    cutoff.setUTCDate(cutoff.getUTCDate() - WINDOW_DAYS);
    const cutoffIso = cutoff.toISOString().slice(0, 10);

    const seen = new Set<number>();
    return rows
        .filter((r) => {
            if (seen.has(r.deckId)) return false;
            seen.add(r.deckId);
            return true;
        })
        .filter((r) => isTop8(r.placement) && r.date >= cutoffIso)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * Scryfall's oracle `name` for a split/DFC card is the COMBINED `Front //
 * Back` (verified against `data/oracle-compiled.json`: split and DFC rows
 * carry no standalone front-face entry, only the joined name — "Fire // Ice",
 * "Assault // Battery", "Westvale Abbey // Ormendahl, Profane Prince"). mtgtop8's
 * export instead writes its OWN older bare-slash style, `Fire/Ice`,
 * `Assault/Battery` — never a legal single-faced Magic card name contains a
 * bare `/`, so that is a safe split marker to canonicalise to `//` spacing.
 */
function normalizeSplitName(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.includes(" // ")) return trimmed;
    const bareSlash = trimmed.indexOf("/");
    if (bareSlash === -1) return trimmed;
    return `${trimmed.slice(0, bareSlash).trim()} // ${trimmed.slice(bareSlash + 1).trim()}`;
}

function foldDiacritics(name: string): string {
    return name.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Resolves a plain-ASCII mtgtop8 export name to the lockfile's own oracle
 * `name` when they differ only by diacritics mtgtop8 drops — "Lim-Dul's
 * Vault" for Scryfall's "Lim-Dûl's Vault" — same fail-CLOSED discipline as
 * `lockfileRowsByName`: a fold that resolves to more than one distinct
 * lockfile name is left alone, not guessed.
 */
function buildDiacriticsResolver(lock: Lockfile): (raw: string) => string {
    const exact = new Set(lock.cards.map((c) => c.name));
    const byFold = new Map<string, Set<string>>();
    for (const card of lock.cards) {
        const key = foldDiacritics(card.name);
        const names = byFold.get(key) ?? new Set<string>();
        names.add(card.name);
        byFold.set(key, names);
    }
    return (raw: string): string => {
        if (exact.has(raw)) return raw;
        const candidates = byFold.get(foldDiacritics(raw));
        if (candidates !== undefined && candidates.size === 1)
            return [...candidates][0]!;
        return raw;
    };
}

function parseDeckExport(
    text: string,
    slug: string,
    resolveName: (raw: string) => string
): { main: Tier1DeckEntry[]; sideboard: Tier1DeckEntry[] } {
    const main: Tier1DeckEntry[] = [];
    const sideboard: Tier1DeckEntry[] = [];
    let inSideboard = false;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (line.length === 0) continue;
        if (/^sideboard$/i.test(line)) {
            inSideboard = true;
            continue;
        }
        const m = /^(\d+)\s+(.+)$/.exec(line);
        if (m === null)
            throw new Error(`${slug}: unparseable decklist line "${line}"`);
        const entry: Tier1DeckEntry = {
            count: Number(m[1]),
            name: resolveName(normalizeSplitName(m[2]!)),
        };
        (inSideboard ? sideboard : main).push(entry);
    }
    return { main, sideboard };
}

/**
 * One archetype's picked list: the most recent top-8 candidate within the
 * window whose deck export actually parses to 60 + 15. mtgtop8 occasionally
 * carries a truncated MTGO league export, so a shape failure moves to the
 * next candidate rather than aborting the whole import.
 */
async function importArchetype(
    spec: (typeof ARCHETYPES)[number],
    today: Date,
    resolveName: (raw: string) => string
): Promise<{ deck: Tier1Deck; row: CandidateRow }> {
    const candidates = await pickCandidates(spec.archetypeId, today);
    if (candidates.length === 0)
        throw new Error(
            `${spec.name} (archetype ${spec.archetypeId}): no top-8 placement in the last ${WINDOW_DAYS} days`
        );
    for (const row of candidates) {
        const text = await politeFetch(
            `https://mtgtop8.com/mtgo?d=${row.deckId}`
        );
        const { main, sideboard } = parseDeckExport(
            text,
            spec.slug,
            resolveName
        );
        if (
            totalCopies(main) === TIER1_MAIN_SIZE &&
            totalCopies(sideboard) === TIER1_SIDEBOARD_SIZE
        ) {
            return {
                deck: { slug: spec.slug, name: spec.name, main, sideboard },
                row,
            };
        }
    }
    throw new Error(
        `${spec.name} (archetype ${spec.archetypeId}): every top-8 candidate in the last ` +
            `${WINDOW_DAYS} days failed to parse to ${TIER1_MAIN_SIZE} + ${TIER1_SIDEBOARD_SIZE}`
    );
}

async function importAll(): Promise<void> {
    const today = new Date();
    const fetchedAt = today.toISOString();
    const decks: Tier1Deck[] = [];
    const pinEntries: MetagamePinEntry[] = [];
    const lock = parseLockfile(
        readFileSync(join(ROOT, "data", "oracle-compiled.json"), "utf8")
    );
    const resolveName = buildDiacriticsResolver(lock);

    for (const spec of ARCHETYPES) {
        process.stderr.write(
            `fetching ${spec.name} (archetype ${spec.archetypeId})...\n`
        );
        const { deck, row } = await importArchetype(spec, today, resolveName);
        decks.push(deck);
        pinEntries.push({
            slug: spec.slug,
            archetypeId: spec.archetypeId,
            eventId: row.eventId,
            deckId: row.deckId,
            player: row.player,
            placement: row.placement,
            date: row.date,
            fetchedAt,
        });
    }

    validateDecks(decks, METAGAME_DECKS_PATH);

    const deckFile: MetagameDeckFile = {
        source: {
            supplier: "mtgtop8.com",
            format: "PREM",
            note:
                "The premodern metagame (25 archetypes, owner's list, 2026-09-17): " +
                "the most recent top-8 placement within the last 12 months, one list " +
                "per archetype. Fetched by scripts/premodern-metagame-import.ts --refresh; " +
                "re-run to update. Card names normalised to Scryfall oracle names " +
                "(the combined `Front // Back` for a split/DFC card).",
        },
        decks,
    };
    const pin: MetagamePin = {
        source: "mtgtop8.com",
        format: "PREM",
        fetchedAt,
        decks: pinEntries,
    };

    writeFileSync(
        METAGAME_DECKS_PATH,
        `${JSON.stringify(deckFile, null, 4)}\n`
    );
    writeFileSync(METAGAME_PIN_PATH, `${JSON.stringify(pin, null, 4)}\n`);
}

async function main(): Promise<void> {
    const refresh = process.argv.includes("--refresh");
    if (!refresh) {
        if (existsSync(METAGAME_DECKS_PATH) && existsSync(METAGAME_PIN_PATH)) {
            process.stdout.write(
                "premodern-metagame-decks.json is already pinned — pass --refresh to re-fetch from mtgtop8.\n"
            );
            return;
        }
        process.stderr.write(
            `${METAGAME_DECKS_PATH} missing — run: bun run metagame:import -- --refresh\n`
        );
        process.exit(1);
    }
    await importAll();
    process.stdout.write(
        `wrote ${METAGAME_DECKS_PATH} and ${METAGAME_PIN_PATH}\n`
    );
}

if (import.meta.main) {
    main().catch((err) => {
        process.stderr.write(`${(err as Error).message}\n`);
        process.exit(1);
    });
}
