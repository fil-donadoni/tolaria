#!/usr/bin/env bun
/**
 * List-mode card importer (ADR 0041).
 *
 * Takes a cross-set *worklist* of card names (e.g. the current Vintage Cube),
 * resolves each card's EARLIEST PAPER PRINTING from Scryfall ("prima stampa"),
 * routes it to that set as its home set, dedups against the committed lockfile
 * `data/card-index.json`, and emits each missing card as either:
 *   - an active `CardDefinition`        (free: vanilla / supported-keyword only)
 *   - a commented-out stub              (capability: needs a new engine feature)
 * Cards whose card *layout* isn't modelled (transform/split/adventure/…) are
 * reported as out-of-scope and never emitted.
 *
 * The Scryfall fetch is impure and lives behind the CLI main guard at the
 * bottom — the pure transforms (exported below) are unit-tested over fixtures
 * and never hit the network.
 *
 * Runs under `bun` (not `node`): it reuses the TypeScript colour helper
 * `getColorsFromCost` (via `./lib/set-modules.mjs`) to colour-split its output.
 *
 * Usage:
 *   bun scripts/list-to-cards.mjs vintage-cube
 *   bun scripts/list-to-cards.mjs data/worklists/vintage-cube.txt
 *
 * Output: a staging directory `data/worklists/<slug>.out/` with one colour-split
 * set DIRECTORY per home set (`<set>/<colour>.ts` + an `index.ts` barrel, the
 * same ADR 0043 layout as `convex/cards/sets/<code>/`) plus `report.md`, and an
 * updated `data/card-index.json`. Staging already in final shape means wiring is
 * a directory move; wiring the staged sources into `convex/cards/sets/<code>/` +
 * the registry is a deliberate follow-up step (it is where bugs hide; the tool
 * stages, a human/agent wires).
 */

import {
    readFileSync,
    writeFileSync,
    appendFileSync,
    mkdirSync,
    existsSync,
    rmSync,
} from "node:fs";
import { resolve, basename } from "node:path";
import {
    COLOUR_MODULES,
    moduleForCost,
    writeSetDirectory,
} from "./lib/set-modules.mjs";
import { parseManaCost, formatManaCost } from "./lib/mana-cost.mjs";

export { parseManaCost, formatManaCost };

// ── pure transforms (unit-tested) ────────────────────────────────────────────

/** Card names from a worklist file: one per line, `#` comments and blanks
 *  dropped, surrounding whitespace trimmed. */
export function parseWorklist(text) {
    return text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("#"));
}

// `parseManaCost` / `formatManaCost` now live in `./lib/mana-cost.mjs`,
// shared with `json-to-cards.mjs` (issue #1742) — re-exported above so this
// module's own tests / callers keep importing them from here unchanged. See
// that module for the hybrid/Phyrexian symbol handling and the loud-failure
// path on anything unrecognised (a stub's cost is no longer silently wrong).

/** Earliest tournament-legal *paper* printing from a Scryfall `unique:prints`
 *  list, or null if the card has none. Excludes digital-only games, gold-
 *  bordered / oversized memorabilia, and PROMO printings — a set's prerelease /
 *  promo (e.g. `pmh2`) ships days before the main set, so picking by release
 *  date alone wrongly homes the card in the promo set instead of the original
 *  (`mh2`). Promos are dropped whenever a non-promo paper printing exists.
 *  Among the survivors, the original set's first card wins: earliest release,
 *  then lowest `collector_number` (the in-set ordering). */
export function selectFirstPaperPrint(prints) {
    let paper = prints.filter(
        (p) =>
            (p.games ?? []).includes("paper") &&
            p.border_color !== "gold" &&
            p.set_type !== "memorabilia"
    );
    if (paper.length === 0) return null;

    const nonPromo = paper.filter((p) => !p.promo && p.set_type !== "promo");
    if (nonPromo.length > 0) paper = nonPromo;

    const collectorNum = (p) => {
        const n = parseInt(p.collector_number, 10);
        return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
    };
    return [...paper].sort((a, b) =>
        a.released_at !== b.released_at
            ? a.released_at < b.released_at
                ? -1
                : 1
            : collectorNum(a) - collectorNum(b)
    )[0];
}

// Keyword abilities the engine supports as `staticAbilities[]` (combatRegistry
// + the LEA–LEG static set). A card whose entire oracle text is these is
// "free": it carries no behaviour beyond data. Conservative on purpose —
// anything outside this set routes to `capability`, never a wrongly-active def.
const SUPPORTED_KEYWORDS = new Set([
    "flying",
    "vigilance",
    "trample",
    "first strike",
    "haste",
    "reach",
    "defender",
    "banding",
    "fear",
]);

/** Strip Scryfall reminder text in parentheses, e.g. "Flying (...)". */
function stripReminder(text) {
    return text.replace(/\([^)]*\)/g, "").trim();
}

/** If `oracle` is nothing but supported keywords (comma- or newline-separated),
 *  return them lowercased; otherwise null. */
function keywordAbilities(oracle) {
    const clauses = stripReminder(oracle)
        .split(/[\n,]/)
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);
    if (clauses.length === 0) return [];
    const ok = clauses.every(
        (c) =>
            SUPPORTED_KEYWORDS.has(c) ||
            /^protection from \w+$/.test(c) ||
            /^\w+walk$/.test(c) ||
            c === "legendary landwalk"
    );
    return ok ? clauses : null;
}

/** Mechanical pre-split (ADR 0041): free | capability | out-of-scope. */
export function classify(card) {
    const layout = card.layout ?? "normal";
    if (layout !== "normal")
        return { bucket: "out-of-scope", reason: `layout:${layout}` };
    if ((card.type_line ?? "").includes("Planeswalker"))
        return { bucket: "capability", reason: "planeswalker" };
    const oracle = stripReminder(card.oracle_text ?? "");
    if (oracle === "") return { bucket: "free", reason: "vanilla" };
    if (keywordAbilities(card.oracle_text ?? "") !== null)
        return { bucket: "free", reason: "keyword-only" };
    return { bucket: "capability", reason: "needs-triage" };
}

const MODELLED_RARITIES = new Set(["common", "uncommon", "rare", "mythic"]);
const SUPERTYPES = new Set(["Legendary", "Basic", "Snow", "World", "Ongoing"]);

/** Parse a Scryfall `type_line` ("Legendary Creature — Cat Warrior") into
 *  { supertypes, types, subtypes }. The dash may be an em-dash. */
function parseTypeLine(typeLine) {
    const [left, right] = typeLine.split(/\s+[—-]\s+/);
    const words = (left ?? "").trim().split(/\s+/).filter(Boolean);
    const supertypes = words.filter((w) => SUPERTYPES.has(w));
    const types = words.filter((w) => !SUPERTYPES.has(w));
    const subtypes = (right ?? "").trim().split(/\s+/).filter(Boolean);
    return { supertypes, types, subtypes };
}

function toIdentifier(name) {
    return name
        .replace(/['’]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, " ")
        .trim()
        .split(/\s+/)
        .map((w, i) =>
            i === 0
                ? w.toLowerCase()
                : w[0].toUpperCase() + w.slice(1).toLowerCase()
        )
        .join("");
}

const arr = (a) => `[${a.map((s) => `"${s}"`).join(", ")}]`;

/** TypeScript source for one card. Free → active `CardDefinition`; capability
 *  → the same body, every line commented out, with a leading TODO. Throws on an
 *  unmodelled rarity (never silently drop it). Out-of-scope cards return "".  */
export function emitCardSource(card) {
    const { bucket, reason } = classify(card);
    if (bucket === "out-of-scope") return "";

    if (!MODELLED_RARITIES.has(card.rarity))
        throw new Error(
            `Card "${card.name}" has unmodelled rarity "${card.rarity}" — ` +
                `only common/uncommon/rare/mythic are modelled (ADR 0041). ` +
                `Handle it case-by-case.`
        );

    const { supertypes, types, subtypes } = parseTypeLine(card.type_line ?? "");
    let cost;
    try {
        cost = parseManaCost(card.mana_cost);
    } catch (err) {
        // Name the offending card (issue #1742 fixup) — a 500+ card worklist
        // run otherwise aborts with only the unrecognised symbol, no way to
        // tell which card triggered it.
        throw new Error(`Card "${card.name}": ${err.message}`);
    }
    const power = card.power !== undefined ? Number(card.power) : NaN;
    const toughness =
        card.toughness !== undefined ? Number(card.toughness) : NaN;
    const kw =
        bucket === "free" ? keywordAbilities(card.oracle_text ?? "") : null;

    const fields = [];
    fields.push(`    id: "${card.id}"`);
    fields.push(`    name: "${card.name.replace(/"/g, '\\"')}"`);
    fields.push(`    rarity: "${card.rarity}"`);
    if (cost) fields.push(`    manaCost: ${formatManaCost(cost)}`);
    fields.push(`    types: ${arr(types)}`);
    if (supertypes.length) fields.push(`    supertypes: ${arr(supertypes)}`);
    if (subtypes.length) fields.push(`    subtypes: ${arr(subtypes)}`);
    if (!Number.isNaN(power)) fields.push(`    power: ${power}`);
    if (!Number.isNaN(toughness)) fields.push(`    toughness: ${toughness}`);
    if (kw && kw.length) fields.push(`    staticAbilities: ${arr(kw)}`);

    const body = [
        `export const ${toIdentifier(card.name)}: CardDefinition = {`,
        fields.join(",\n") + ",",
        `};`,
    ].join("\n");

    if (bucket === "free") return body;

    // capability → comment the whole block, prefix a TODO
    const commented = body
        .split("\n")
        .map((l) => (l ? `// ${l}` : "//"))
        .join("\n");
    return `// TODO(${reason}): implement — needs a new engine capability.\n${commented}`;
}

/** Split resolved cards into those already in the lockfile (by oracleId) and
 *  the genuinely missing ones. */
export function dedupByOracle(cards, lockfile) {
    const have = new Set(lockfile.map((e) => e.oracleId));
    const missing = [];
    const done = [];
    for (const c of cards) (have.has(c.oracleId) ? done : missing).push(c);
    return { missing, done };
}

// ── impure CLI (not exercised by tests) ──────────────────────────────────────

const SCRYFALL = "https://api.scryfall.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET with a hard per-request timeout (`fetch` has none — one hung connection
 *  stalls the whole sequential run) and bounded retries with backoff. Retries
 *  on network errors AND on rate-limit / transient server status (429/5xx),
 *  honouring `Retry-After` when present. */
async function getJson(url, attempts = 5, timeoutMs = 15000) {
    let lastErr;
    for (let a = 1; a <= attempts; a++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const res = await fetch(url, {
                headers: {
                    "User-Agent": "tolaria-list-to-cards/1.0",
                    Accept: "application/json",
                },
                signal: ctrl.signal,
            });
            clearTimeout(timer);
            if ((res.status === 429 || res.status >= 500) && a < attempts) {
                const retryAfter = Number(res.headers.get("retry-after")) || 0;
                await sleep(Math.max(retryAfter * 1000, 2000 * a));
                continue;
            }
            return res;
        } catch (e) {
            clearTimeout(timer);
            lastErr = e;
            if (a < attempts) await sleep(500 * a);
        }
    }
    if (lastErr) throw lastErr;
    return { status: 429, ok: false }; // exhausted retries on rate limit
}

/** Fetch the earliest paper printing of a card by exact name, with its oracle
 *  fields. One Scryfall search call (`unique:prints order:released asc`). */
async function fetchFirstPaperPrint(name) {
    const q = encodeURIComponent(`!"${name}" game:paper`);
    const url = `${SCRYFALL}/cards/search?order=released&dir=asc&unique=prints&q=${q}`;
    let res;
    try {
        res = await getJson(url);
    } catch {
        return { name, error: "timeout" };
    }
    if (res.status === 404) return { name, error: "not-found" };
    if (!res.ok) return { name, error: `http-${res.status}` };
    const json = await res.json();
    const print = selectFirstPaperPrint(json.data ?? []);
    if (!print) return { name, error: "no-paper-print" };
    return {
        name: print.name,
        layout: print.layout,
        type_line: print.type_line,
        oracle_text: print.oracle_text ?? "",
        mana_cost: print.mana_cost,
        power: print.power,
        toughness: print.toughness,
        rarity: print.rarity,
        id: print.id,
        firstSet: print.set,
        oracleId: print.oracle_id,
    };
}

async function main() {
    const argRaw = process.argv[2];
    if (!argRaw) {
        console.error(
            "Usage: bun scripts/list-to-cards.mjs <worklist-slug|path>"
        );
        process.exit(1);
    }
    const slug = basename(argRaw).replace(/\.txt$/, "");
    const worklistPath = existsSync(argRaw)
        ? argRaw
        : resolve("data/worklists", `${slug}.txt`);
    const names = parseWorklist(readFileSync(resolve(worklistPath), "utf-8"));

    const lockPath = resolve("data/card-index.json");
    const lockfile = existsSync(lockPath)
        ? JSON.parse(readFileSync(lockPath, "utf-8"))
        : [];

    // Resume checkpoint: every successful Scryfall resolution is appended as one
    // JSON line to `<slug>.resolved.jsonl` the instant it lands. A killed run
    // (teardown, timeout, Ctrl-C) loses nothing — on restart we replay the file
    // and skip those names. Errors are NOT checkpointed, so they retry. Deleted
    // on clean completion.
    const checkpointPath = resolve("data/worklists", `${slug}.resolved.jsonl`);
    const resolved = [];
    const checkpointedNames = new Set();
    if (existsSync(checkpointPath)) {
        for (const line of readFileSync(checkpointPath, "utf-8").split("\n")) {
            if (!line.trim()) continue;
            try {
                const card = JSON.parse(line);
                resolved.push(card);
                checkpointedNames.add(card.queryName ?? card.name);
            } catch {
                // tolerate a torn final line from an abrupt kill
            }
        }
    }

    // Pre-skip names already in the lockfile or the checkpoint, to avoid
    // refetching the bulk of a worklist (oracleId dedup below still catches
    // alt-name overlaps among the ones we do fetch).
    const knownNames = new Set(lockfile.map((e) => e.name));
    const toFetch = names.filter(
        (n) => !knownNames.has(n) && !checkpointedNames.has(n)
    );
    const knownCount = names.length - toFetch.length;

    console.log(
        `${names.length} cards: ${knownCount} skipped ` +
            `(${checkpointedNames.size} from checkpoint, rest by name), ` +
            `${toFetch.length} to resolve from Scryfall…`
    );
    const errors = [];
    // Bounded concurrency: a pool of workers pulls names off a shared cursor.
    // Sequential at ~0.4s/request is ~20min for a cube; 4 workers + a 150ms
    // per-request throttle keeps us near Scryfall's ~10 req/s ceiling (retry
    // absorbs the occasional 429) and finishes in a few minutes.
    const CONCURRENCY = 2;
    let cursor = 0;
    let done_ = 0;
    async function worker() {
        while (cursor < toFetch.length) {
            const name = toFetch[cursor++];
            const card = await fetchFirstPaperPrint(name);
            done_++;
            if (card.error) {
                errors.push(card);
                console.log(
                    `[${done_}/${toFetch.length}] ${name} → ERROR ${card.error}`
                );
            } else {
                // `queryName` is the worklist name we searched for (Scryfall may
                // return a different canonical `name`, e.g. a DFC's combined
                // face) — resume matches against it. Append-then-push so a crash
                // mid-iteration never leaves an in-memory result unpersisted.
                const entry = { ...card, queryName: name };
                appendFileSync(checkpointPath, JSON.stringify(entry) + "\n");
                resolved.push(entry);
                console.log(
                    `[${done_}/${toFetch.length}] ${name} → ${card.firstSet}`
                );
            }
            await sleep(250); // throttle per worker (2 workers → ~4 req/s, < limit)
        }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const { missing } = dedupByOracle(resolved, lockfile);
    const done = names.length - missing.length - errors.length;

    // bucket the missing cards
    const bySet = new Map();
    const buckets = { free: [], capability: [], "out-of-scope": [] };
    for (const card of missing) {
        const { bucket } = classify(card);
        buckets[bucket].push(card);
        if (bucket === "out-of-scope") continue;
        if (!bySet.has(card.firstSet)) bySet.set(card.firstSet, []);
        bySet.get(card.firstSet).push(card);
    }

    // stage output — one colour-split set DIRECTORY per home set (ADR 0043),
    // matching the `convex/cards/sets/<code>/` layout so wiring is a move.
    const outDir = resolve("data/worklists", `${slug}.out`);
    if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    // Colour modules sit at `<slug>.out/<set>/<colour>.ts`, four levels deep, so
    // the type import reaches the repo's convex/ via four `..` segments.
    const importLine = `import type { CardDefinition } from "../../../../convex/cards/types";`;
    for (const [set, cards] of [...bySet].sort()) {
        const sources = Object.fromEntries(COLOUR_MODULES.map((m) => [m, []]));
        for (const card of cards) {
            const src = emitCardSource(card);
            if (!src) continue; // out-of-scope cards emit ""
            // Route by the colour identity of the card's mana cost (CR 202.2);
            // lands / colourless artifacts (no coloured cost) → colorless.ts.
            let costForRouting;
            try {
                costForRouting = parseManaCost(card.mana_cost);
            } catch (err) {
                // Name the offending card (issue #1742 fixup) — see the
                // matching try/catch in `emitCardSource` above.
                throw new Error(`Card "${card.name}": ${err.message}`);
            }
            sources[moduleForCost(costForRouting)].push(src);
        }
        writeSetDirectory(outDir, set, sources, importLine);
    }

    // report
    const report = [
        `# ${slug} — import coverage`,
        "",
        `- Worklist: **${names.length}**`,
        `- Resolved: **${resolved.length}** (errors: ${errors.length})`,
        `- Already implemented: **${done}**`,
        `- Free (active): **${buckets.free.length}**`,
        `- Capability (stub): **${buckets.capability.length}**`,
        `- Out-of-scope (layout): **${buckets["out-of-scope"].length}**`,
        `- Home sets touched: **${bySet.size}**`,
        "",
        "## Out-of-scope (one ready-for-human issue per layout)",
        ...buckets["out-of-scope"].map(
            (c) => `- ${c.name} — ${classify(c).reason}`
        ),
        "",
        "## Errors",
        ...errors.map((e) => `- ${e.name} — ${e.error}`),
        "",
    ].join("\n");
    writeFileSync(resolve(outDir, "report.md"), report, "utf-8");

    // NB: the importer is READ-ONLY on the lockfile — it never writes staged
    // cards back. A staged card is not yet *implemented* (it lives in `.out/`,
    // not in `convex/cards/sets/`), so adding it would conflate "staged" with
    // "done" and poison the next run's dedup. The lockfile gains a card's id
    // only at WIRING time (or via `backfill-card-index.ts`, which reads the
    // registry). This keeps the importer idempotent: same worklist + same
    // lockfile → identical `.out/`.

    // Drop the resume checkpoint ONLY on a fully clean run. If any card errored
    // (429/503/timeout), keep it so the next run resumes — re-fetching just the
    // failures while the checkpointed successes still feed a complete staging.
    if (errors.length === 0 && existsSync(checkpointPath))
        rmSync(checkpointPath);
    else if (errors.length)
        console.log(
            `\n${errors.length} errored — checkpoint kept; re-run to resume.`
        );

    console.log(report);
    console.log(`Staged → ${outDir}`);
}

// Run only as a script, never on import (keeps tests network-free).
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
