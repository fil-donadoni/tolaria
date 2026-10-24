#!/usr/bin/env node
/**
 * Downloads the Scryfall `default_cards` bulk → columnar reduction →
 * `data/full-catalogue/full-catalogue-<hash>.json.gz`.
 *
 * Usage:
 *   node scripts/fetch-full-catalogue.mjs
 *
 * Output:
 *   data/full-catalogue/full-catalogue-<hash>.json.gz — columnar, one array
 *   per field, gzipped, and CONTENT-ADDRESSED: the file name is the first 16
 *   hex characters of the sha256 of its own bytes (issue #3500, mirroring
 *   `scripts/lib/catalogue-merge.ts`). The directory holds exactly one, the
 *   stale one is deleted here, and `src/lib/fullCatalogue.ts` resolves the URL
 *   from whatever it finds — so a regenerated catalogue is a NEW URL that no
 *   CDN or browser cache can answer with the old payload. The asset used to be
 *   a verbatim copy at `public/data/full-catalogue.json.gz`, whose name never
 *   moved and which Vercel's `/assets/` immutable rule never covered.
 *
 * Reduction (per ADR 0080):
 *   - columnar (arrays per field, not an array of objects)
 *   - no `oracleId` — printings are fetched by exact name later
 *   - UUIDs without dashes
 *   - no `oracle_text`
 *   - exclude layouts: art_series, vanguard, scheme, planar, emblem
 *   - exclude non-paper cards
 *   - include tokens
 *
 * ── Why `default_cards` and not `oracle_cards` ──────────────────────────────
 *
 * `oracle_cards` is one row per card — exactly the shape this file wants, and
 * a quarter of the download. It was the original source, and it silently drops
 * paper cards.
 *
 * The row it gives you is ONE representative printing, chosen by Scryfall, and
 * a card's representative can be a digital-only printing: Mox Diamond's is
 * Tempest Remastered (MTGO, `digital: true`, `games: ["mtgo"]`), as are
 * Recurring Nightmare's and Corpse Dance's. Filtering that row on
 * `games.includes("paper")` therefore does not ask "does this card exist on
 * paper" — it asks "is the printing Scryfall happened to pick a paper one",
 * and drops three cards that have been in print since Tempest.
 *
 * `default_cards` is one row per PRINTING, so paper-ness is observable rather
 * than inferred: keep the paper printings, group by `oracle_id`, and emit the
 * best one. A card survives iff it has at least one paper printing, which is
 * the actual rule.
 *
 * ── Card names ──────────────────────────────────────────────────────────────
 *
 * Scryfall's top-level `name` on a multi-faced card is the COMBINED name
 * ("Brazen Borrower // Petty Theft"). For every layout except `split`/`room`
 * that is not the card's name — the card is "Brazen Borrower" — and nothing
 * else in this project uses the combined form (`data/card-index.json` has zero
 * names containing "//"), so those rows matched nothing: not the availability
 * cross-reference, not a cube list, not a deck import.
 *
 * The same applies to the other printed characteristics. A `transform` card
 * has `mana_cost: null` and a combined `type_line` at top level — both live on
 * the faces — so every double-faced row in the old catalogue carried an empty
 * mana cost and a "X // Y" type line.
 */

import { createWriteStream, existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname, join } from "node:path";
import { createGzip, createGunzip } from "node:zlib";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { finished } from "node:stream/promises";
import { Readable } from "node:stream";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir = resolve(repoRoot, "data/full-catalogue");
/** Written first, hashed, then renamed. A crash mid-write must not leave a
 *  file whose NAME claims a hash its bytes do not have. */
const stagingPath = resolve(outDir, "full-catalogue.staging.json.gz");

/** How many hex characters of the sha256 go in the file name — the same 16 as
 *  the compiled catalogue artifact (`scripts/lib/catalogue-merge.ts`). */
const HASH_CHARS = 16;

export const artifactFileName = (hash) => `full-catalogue-${hash}.json.gz`;

/** Every artifact currently in `data/full-catalogue/`, sorted. Shared with
 *  `ensure-full-catalogue.mjs`, which must ask the same question. */
export function committedArtifacts(dir = outDir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter((f) => f.startsWith("full-catalogue-") && f.endsWith(".json.gz"))
        .sort();
}

const SCRYFALL_BULK = "https://api.scryfall.com/bulk-data/default-cards";

// Layouts that are not cards you can put in a deck.
const EXCLUDED_LAYOUTS = new Set([
    "art_series",
    "vanguard",
    "scheme",
    "planar",
    "emblem",
]);

// The two layouts whose real card name IS the combined "A // B" form (CR 708 —
// split cards, and Rooms, which share it). Every other multi-faced layout
// (transform, modal_dfc, adventure, flip, meld, reversible_card) is named for
// its front face.
const COMBINED_NAME_LAYOUTS = new Set(["split", "room"]);

/**
 * The printed characteristics to index a card under: its real name, type line
 * and mana cost. Reads the front face for the layouts that have one, because
 * Scryfall puts the combined form at top level (and, for `transform`, no mana
 * cost at all).
 */
function printedCharacteristics(card) {
    const faces = card.card_faces;
    const layout = (card.layout ?? "").toLowerCase();
    const useFace =
        Array.isArray(faces) &&
        faces.length > 0 &&
        !COMBINED_NAME_LAYOUTS.has(layout);
    const face = useFace ? faces[0] : card;
    return {
        name: face.name ?? card.name ?? "",
        typeLine: face.type_line ?? card.type_line ?? "",
        manaCost: face.mana_cost ?? card.mana_cost ?? "",
    };
}

/**
 * How ordinary a printing's SET is. Ranked rather than filtered: a card whose
 * only paper printing is a World Championship deck still has to appear, it
 * just must never win over a normal one.
 *
 * "Most recent paper printing" alone is not a good default — it lands on
 * gold-bordered World Championship decks (Recurring Nightmare → wc98, Corpse
 * Dance → wc99) and on The List (Bonecrusher Giant, Jace, Vryn's Prodigy),
 * none of which look like the card a player pictures.
 */
const SET_TYPE_TIER = new Map([
    // A regular constructed-legal printing.
    ["core", 4],
    ["expansion", 4],
    // Reprint products — normal frame, normal border.
    ["masters", 3],
    ["draft_innovation", 3],
    ["commander", 3],
    ["starter", 3],
    ["box", 3],
    ["duel_deck", 3],
    ["from_the_vault", 3],
    ["premium_deck", 3],
    ["spellbook", 3],
    ["arsenal", 3],
    // Real cards in unusual frames or distribution.
    ["masterpiece", 2],
    ["promo", 2],
    ["planechase", 2],
    ["archenemy", 2],
    ["treasure_chest", 2],
    ["funny", 1],
    ["minigame", 1],
    ["token", 1],
    // Gold-bordered collectables and digital-only products.
    ["memorabilia", 0],
    ["alchemy", 0],
]);

/**
 * Ranks two paper printings of the same card; higher wins. Deterministic, so
 * regenerating the catalogue from the same bulk yields the same file.
 *
 * The default printing a browser row shows should be a real, photographed,
 * normal-looking card. The `id` tie-break keeps the order total.
 */
function printScore(card) {
    const missingArt =
        card.image_status === "missing" || card.image_status === "placeholder";
    return [
        card.oversized ? 0 : 1,
        missingArt ? 0 : 1,
        SET_TYPE_TIER.get(card.set_type) ?? 2,
        card.border_color === "black" ? 1 : 0,
        card.promo ? 0 : 1,
        card.highres_image ? 1 : 0,
        card.released_at ?? "",
        card.id ?? "",
    ];
}

function betterPrint(a, b) {
    if (!a) return b;
    const sa = printScore(a);
    const sb = printScore(b);
    for (let i = 0; i < sa.length; i++) {
        if (sa[i] === sb[i]) continue;
        return sa[i] > sb[i] ? a : b;
    }
    return a;
}

/**
 * The identity two printings must share to be the same catalogue row.
 *
 * `oracle_id` is the right key and is usually present, but some printings
 * carry it only on their faces (reversible cards) or not at all, and falling
 * back to the PRINT id makes each of those its own row — the same card twice
 * in the results, which is how the Vintage Cube resolved 541 entries for 540
 * cards (Ugin, Eye of the Storms appeared twice, identical but for its id).
 *
 * The name is the last resort because it is what every consumer keys on
 * anyway. Tokens are namespaced apart: a token and a real card can share a
 * name exactly (Thundertrap Trainer) and are not the same object (CR 111).
 */
function cardKey(card) {
    const oracleId = card.oracle_id ?? card.card_faces?.[0]?.oracle_id;
    if (oracleId) return `oracle:${oracleId}`;
    const isToken = (card.layout ?? "").toLowerCase() === "token";
    return `name:${isToken ? "token:" : ""}${printedCharacteristics(card).name}`;
}

/** True when this bulk row is a paper printing of a real, deckable card. */
function isPaperPrinting(card) {
    if (card.lang && card.lang !== "en") return false;
    if (Array.isArray(card.games) && !card.games.includes("paper"))
        return false;
    const layout = (card.layout ?? "").toLowerCase();
    if (layout !== "token" && EXCLUDED_LAYOUTS.has(layout)) return false;
    return true;
}

// Scryfall rejects requests carrying an HTTP library's default User-Agent
// (`400 bad_request / generic_user_agent`), which surfaced here as the
// misleading "No download URI in bulk data definition". Every other Scryfall
// script in scripts/ already identifies itself; this one did not.
const SCRYFALL_HEADERS = {
    "User-Agent": "tolaria-fetch-full-catalogue/1.0",
    Accept: "*/*",
};

async function main() {
    // 1. Fetch the bulk data definition to get the download URL.
    console.log("Fetching bulk data index...");
    const bulkDefRes = await fetch(SCRYFALL_BULK, {
        headers: SCRYFALL_HEADERS,
    });
    if (!bulkDefRes.ok) {
        throw new Error(
            `Bulk data index failed: ${bulkDefRes.status} ${bulkDefRes.statusText}`
        );
    }
    const bulkDef = await bulkDefRes.json();
    // Scryfall now serves JSONL (jsonl_download_uri). Prefer that; fall back
    // to the old JSON-array download_uri.
    const downloadUri = bulkDef.jsonl_download_uri ?? bulkDef.download_uri;
    if (!downloadUri) {
        throw new Error("No download URI in bulk data definition");
    }
    const isJsonl = Boolean(bulkDef.jsonl_download_uri);
    console.log(
        `Download URL: ${downloadUri} (${isJsonl ? "jsonl.gz" : "json"})`
    );

    // 2. Download the full oracle-cards.
    console.log("Downloading oracle_cards bulk...");
    const bulkRes = await fetch(downloadUri, { headers: SCRYFALL_HEADERS });
    if (!bulkRes.ok) {
        throw new Error(`Bulk download failed: ${bulkRes.status}`);
    }

    // 3. Filter to paper printings and collapse to one row per card.
    //    `default_cards` is one row per PRINTING, so a card appears many
    //    times; `best` keeps the highest-ranked paper printing seen for each
    //    card identity (see `cardKey`).
    const best = new Map();
    let seen = 0;
    let skipped = 0;

    const ingest = (card) => {
        seen++;
        if (!isPaperPrinting(card)) {
            skipped++;
            return;
        }
        const key = cardKey(card);
        best.set(key, betterPrint(best.get(key), card));
    };

    if (isJsonl) {
        // JSONL .gz — decompress stream + readline.
        console.log("Decompressing + parsing JSONL...");
        const gunzip = createGunzip();
        const source = Readable.fromWeb(bulkRes.body);
        source.pipe(gunzip);
        const rl = createInterface({ input: gunzip });
        for await (const line of rl) {
            if (!line.trim()) continue;
            ingest(JSON.parse(line));
        }
        await finished(gunzip);
    } else {
        // Legacy JSON array.
        const bulkText = await bulkRes.text();
        const allCards = JSON.parse(bulkText);
        console.log(`Downloaded ${allCards.length} printing rows.`);
        for (const card of allCards) ingest(card);
    }

    // Sorted by print id so the emitted arrays — and therefore the gzipped
    // bytes — do not depend on the bulk file's row order.
    const paper = [...best.values()].sort((a, b) =>
        (a.id ?? "").localeCompare(b.id ?? "")
    );

    console.log(
        `${paper.length} cards from ${seen} printing rows (${skipped} rows skipped: non-paper, non-English or excluded layout).`
    );

    // 4. Build columnar arrays.
    const uuidNoDash = (id) => (id ?? "").replace(/-/g, "");

    const names = [];
    const printIds = [];
    const typeLines = [];
    const manaCosts = [];
    const cmcs = [];
    const colourIdentities = [];
    const sets = [];
    const rarities = [];

    for (const card of paper) {
        // Colour identity is an array of single letters; store as joined string.
        const ci = card.color_identity ?? [];
        const ciStr = Array.isArray(ci) ? ci.join("") : "";

        // CMC: prefer cmc over convertedManaCost for newer data.
        const cmc = typeof card.cmc === "number" ? card.cmc : 0;

        // Rarity: Scryfall uses lowercase; store as-is.
        const rarity = card.rarity ?? "";

        // Set: use the set code.
        const setCode = card.set ?? "";

        // Name / type line / mana cost come from the front face on a
        // multi-faced card — see `printedCharacteristics`.
        const { name, typeLine, manaCost } = printedCharacteristics(card);

        names.push(name);
        printIds.push(uuidNoDash(card.id));
        typeLines.push(typeLine);
        manaCosts.push(manaCost);
        cmcs.push(cmc);
        colourIdentities.push(ciStr);
        sets.push(setCode);
        rarities.push(rarity);
    }

    const result = {
        names,
        printIds,
        typeLines,
        manaCosts,
        cmcs,
        colourIdentities,
        sets,
        rarities,
    };

    // 5. Write as gzipped JSON, content-addressed.
    const json = JSON.stringify(result);

    await mkdir(outDir, { recursive: true });

    // Write through gzip, to the staging name.
    await new Promise((resolvePromise, reject) => {
        const gzip = createGzip({ level: 9 });
        const out = createWriteStream(stagingPath);
        gzip.pipe(out);
        gzip.on("error", reject);
        out.on("finish", resolvePromise);
        out.on("error", reject);
        gzip.end(json);
    });

    // The hash is of the BYTES ON DISK, not of the JSON they compress: those
    // bytes are what the browser fetches and what the name has to identify.
    const gzBytes = await readFile(stagingPath);
    const hash = createHash("sha256")
        .update(gzBytes)
        .digest("hex")
        .slice(0, HASH_CHARS);
    const fileName = artifactFileName(hash);
    const outPath = join(outDir, fileName);
    await rename(stagingPath, outPath);

    // Exactly one artifact, always: a stale sibling would leave the client's
    // build-time glob with two candidates and no way to choose (it refuses,
    // by design — `fullCatalogueUrl`).
    for (const stale of committedArtifacts()) {
        if (stale !== fileName) await rm(join(outDir, stale));
    }

    const rawSize = Buffer.byteLength(json, "utf-8");
    const gzSize = (await stat(outPath)).size;

    console.log(
        `Wrote ${outPath} — ${paper.length} rows, ` +
            `${(rawSize / 1024).toFixed(1)} KB raw / ` +
            `${(gzSize / 1024).toFixed(1)} KB gz ` +
            `(${(gzSize / paper.length).toFixed(1)} B/card).`
    );

    if (gzSize > 1_500_000) {
        console.warn(
            `\nWARNING: ${(gzSize / 1024).toFixed(0)} KB exceeds the 1.5 MB budget.`
        );
    }
}

// Importable (`ensure-full-catalogue.mjs` reads the naming helpers) without
// downloading a 200 MB bulk as a side effect.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
