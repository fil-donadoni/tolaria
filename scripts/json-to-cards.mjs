#!/usr/bin/env bun
/**
 * Converts an MTGJSON set file into a colour-split set DIRECTORY (ADR 0043).
 *
 * Usage:
 *   bun scripts/json-to-cards.mjs data/LEA.json
 *
 * Output: convex/cards/sets/<setCode>/ — one file per colour module
 *         (white|blue|black|red|green|multicolor|colorless) + an index.ts
 *         barrel. Each card is routed to its module by the colour identity of
 *         its mana cost (CR 202.2; lands / colourless artifacts → colorless.ts).
 *         Runs under `bun` (not `node`) because it reuses the TypeScript colour
 *         helper `getColorsFromCost`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    COLOUR_MODULES,
    moduleForCost,
    writeSetDirectory,
} from "./lib/set-modules.mjs";
import { parseManaCost, formatManaCost } from "./lib/mana-cost.mjs";

export { parseManaCost, formatManaCost };

const jsonPath = process.argv[2];
if (!jsonPath) {
    console.error("Usage: node scripts/json-to-cards.mjs <path-to-set.json>");
    process.exit(1);
}

const raw = JSON.parse(readFileSync(resolve(jsonPath), "utf-8"));
const setData = raw.data;
const setCode =
    setData.code?.toLowerCase() ??
    setData.cards?.[0]?.setCode?.toLowerCase() ??
    "unknown";
const cards = setData.cards;

// ── helpers ──────────────────────────────────────────────────────────────────

// `parseManaCost` / `formatManaCost` now live in `./lib/mana-cost.mjs`,
// shared with `list-to-cards.mjs` (issue #1742) — see that module for the
// hybrid/Phyrexian symbol handling and the loud-failure path on anything
// unrecognised.

function toIdentifier(name) {
    return name
        .replace(/['']/g, "")
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

function toSnakeId(name) {
    return name
        .replace(/['']/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
        .toLowerCase();
}

function formatArray(arr) {
    if (!arr || arr.length === 0) return undefined;
    return `[${arr.map((s) => `"${s}"`).join(", ")}]`;
}

// ── main ─────────────────────────────────────────────────────────────────────

// One bucket of card-definition source strings per colour module (ADR 0043).
// `writeSetDirectory` emits an empty module (header + `export {}`) for any
// bucket that stays empty, so every set has the same sparse seven-module shape.
const sources = Object.fromEntries(COLOUR_MODULES.map((m) => [m, []]));

const seenIds = new Set();

for (const card of cards) {
    // Skip tokens, funny cards, etc.
    if (card.layout === "token" || card.layout === "art_series") continue;

    let varName = toIdentifier(card.name);
    let id = toSnakeId(card.name);

    const scryfallId = card.identifiers?.scryfallId;
    if (!scryfallId) continue;

    // Deduplicate (some sets have multiple printings of basics, etc.)
    if (seenIds.has(varName)) continue;
    seenIds.add(varName);

    const types = card.types ?? [];
    const manaCost = parseManaCost(card.manaCost);
    const subtypes = card.subtypes?.length ? card.subtypes : undefined;
    const supertypes = card.supertypes?.length ? card.supertypes : undefined;
    const power = card.power !== undefined ? Number(card.power) : undefined;
    const toughness =
        card.toughness !== undefined ? Number(card.toughness) : undefined;

    // Rarity is required on every CardDefinition (CR 206, issue #511). MTGJSON
    // carries it per printing; bail loudly on an unexpected value so a new card
    // can never be generated without a valid rarity.
    const rarity = card.rarity;
    if (!["common", "uncommon", "rare"].includes(rarity)) {
        console.error(
            `Card "${card.name}" has unsupported rarity "${rarity}" — ` +
                `only common/uncommon/rare are modelled. Skipping.`
        );
        continue;
    }

    const fields = [];
    fields.push(`    id: "${scryfallId}"`);
    fields.push(`    name: "${card.name.replace(/"/g, '\\"')}"`);
    fields.push(`    rarity: "${rarity}"`);
    if (manaCost) fields.push(`    manaCost: ${formatManaCost(manaCost)}`);
    fields.push(`    types: ${formatArray(types)}`);
    if (supertypes) fields.push(`    supertypes: ${formatArray(supertypes)}`);
    if (subtypes) fields.push(`    subtypes: ${formatArray(subtypes)}`);
    if (!isNaN(power)) fields.push(`    power: ${power}`);
    if (!isNaN(toughness)) fields.push(`    toughness: ${toughness}`);

    const source = [
        `export const ${varName}: CardDefinition = {`,
        fields.join(",\n") + ",",
        `};`,
    ].join("\n");

    // Route each card to its colour module by the colour identity of its mana
    // cost (CR 202.2): lands / colourless artifacts (no coloured cost) →
    // colorless; one colour → that module; two or more → multicolor.
    sources[moduleForCost(manaCost)].push(source);
}

// ── write ────────────────────────────────────────────────────────────────────

// Default output is the live catalogue (`convex/cards/sets`). Tests override it
// (JSON_TO_CARDS_OUT_DIR) to a throwaway tmp dir so their generate/cleanup can
// never race a concurrent worker walking the real sets tree (sacrificeGuard).
const setsDir = resolve(
    process.env.JSON_TO_CARDS_OUT_DIR ?? "convex/cards/sets"
);
// Colour modules live at `sets/<code>/<colour>.ts`, two levels above `cards/`.
const importLine = `import type { CardDefinition } from "../../types";`;
const setDir = writeSetDirectory(setsDir, setCode, sources, importLine);
console.log(
    `Written ${seenIds.size} cards → ${setDir}/ (colour-split, ADR 0043)`
);
