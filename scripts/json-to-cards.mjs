#!/usr/bin/env node
/**
 * Converts an MTGJSON set file into a TypeScript card definitions file.
 *
 * Usage:
 *   node scripts/json-to-cards.mjs data/LEA.json
 *
 * Output: convex/cards/sets/<setCode>.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

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

const COLOR_MAP = { W: "W", U: "U", B: "B", R: "R", G: "G", C: "C" };

function parseManaCost(mana) {
    if (!mana) return undefined;
    const manaCost = {};
    let genericNum = 0;
    let xCount = 0;
    const symbols = mana.match(/\{[^}]+\}/g) ?? [];
    for (const sym of symbols) {
        const inner = sym.slice(1, -1);
        if (/^\d+$/.test(inner)) {
            genericNum += Number(inner);
        } else if (inner === "X") {
            xCount++;
        } else if (COLOR_MAP[inner]) {
            const color = COLOR_MAP[inner];
            manaCost[color] = (manaCost[color] ?? 0) + 1;
        }
        // hybrid / phyrexian / snow — extend later
    }
    if (xCount > 0) {
        manaCost.X = "X".repeat(xCount);
    } else if (genericNum > 0) {
        manaCost.X = genericNum;
    }
    return Object.keys(manaCost).length > 0 ? manaCost : undefined;
}

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

function formatCost(manaCost) {
    if (!manaCost) return "{}";
    const parts = [];
    const order = ["X", "W", "U", "B", "R", "G", "C"];
    for (const k of order) {
        if (manaCost[k] !== undefined) {
            const val =
                typeof manaCost[k] === "string"
                    ? `"${manaCost[k]}"`
                    : manaCost[k];
            parts.push(`${k}: ${val}`);
        }
    }
    return `{ ${parts.join(", ")} }`;
}

function formatArray(arr) {
    if (!arr || arr.length === 0) return undefined;
    return `[${arr.map((s) => `"${s}"`).join(", ")}]`;
}

// ── main ─────────────────────────────────────────────────────────────────────

const lines = [];
lines.push(`import type { Card } from "../types";`);
lines.push("");

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

    const fields = [];
    fields.push(`    id: "${scryfallId}"`);
    fields.push(`    name: "${card.name.replace(/"/g, '\\"')}"`);
    if (manaCost) fields.push(`    manaCost: ${formatCost(manaCost)}`);
    fields.push(`    types: ${formatArray(types)}`);
    if (supertypes) fields.push(`    supertypes: ${formatArray(supertypes)}`);
    if (subtypes) fields.push(`    subtypes: ${formatArray(subtypes)}`);
    if (!isNaN(power)) fields.push(`    power: ${power}`);
    if (!isNaN(toughness)) fields.push(`    toughness: ${toughness}`);

    lines.push(`export const ${varName}: Card = {`);
    lines.push(fields.join(",\n") + ",");
    lines.push(`};`);
    lines.push("");
}

// ── write ────────────────────────────────────────────────────────────────────

const outDir = resolve("convex/cards/sets");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, `${setCode}.ts`);
writeFileSync(outPath, lines.join("\n"), "utf-8");
console.log(`Written ${seenIds.size} cards → ${outPath}`);
