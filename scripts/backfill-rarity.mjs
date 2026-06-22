#!/usr/bin/env node
/**
 * One-shot backfill: injects a `rarity` field into every `CardDefinition` and
 * `CardPrint` literal across `convex/cards/sets/*.ts`, sourced from the raw
 * MTGJSON files under `data/json/`. Run once when per-card Rarity was added to
 * the card model (issue #511); the generator (`json-to-cards.mjs`) emits rarity
 * for all future cards, so this is not part of the normal build.
 *
 * Rarity is a property of a *printing* (CR 206), so each printing's own
 * Scryfall id is the lookup key:
 *   - A `CardDefinition` literal carries `id: "<scryfallId>"` → look up that id.
 *   - A `CardPrint` literal carries `printId: "<scryfallId>"` → look up that id;
 *     LEB has no MTGJSON file (Beta == Alpha), so a LEB print falls back to the
 *     rarity of the definition it references (`definitionId`).
 *
 * Idempotent: a literal that already declares `rarity:` is left untouched.
 *
 * Usage: node scripts/backfill-rarity.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DATA_SETS = ["LEA", "2ED", "ARN", "ATQ", "DRK", "LEG"];
const SET_FILES = ["lea", "leb", "arn", "atq", "drk", "leg", "2ed"];

const VALID = new Set(["common", "uncommon", "rare"]);

// scryfallId → rarity, from every MTGJSON set file.
const rarityByScryfall = new Map();
for (const s of DATA_SETS) {
    const raw = JSON.parse(
        readFileSync(resolve(`data/json/${s}.json`), "utf-8")
    );
    for (const c of raw.data.cards) {
        const id = c.identifiers?.scryfallId;
        if (!id) continue;
        if (!VALID.has(c.rarity)) {
            throw new Error(`Unexpected rarity "${c.rarity}" for ${c.name}`);
        }
        rarityByScryfall.set(id, c.rarity);
    }
}

// Pass 1: build definitionId → rarity from the (already-known) definition ids,
// so LEB prints that point at a LEA definition can resolve their rarity even
// though LEB itself has no MTGJSON file. A definition's id IS a Scryfall id.
const rarityByDefinitionId = rarityByScryfall;

let totalInjected = 0;
const summary = [];

for (const sf of SET_FILES) {
    const path = resolve(`convex/cards/sets/${sf}.ts`);
    const src = readFileSync(path, "utf-8");
    const lines = src.split("\n");

    // Some definitions reference their id via a named constant
    // (`id: NAFS_ASP_ID`). Resolve those constants to their string value so
    // the same rarity lookup works. `const FOO_ID = "<uuid>";`
    const constToId = new Map();
    for (const l of lines) {
        const m = l.match(/^const ([A-Z_][A-Z0-9_]*) = "([0-9a-f-]+)";/);
        if (m) constToId.set(m[1], m[2]);
    }

    const out = [];
    let injected = 0;
    let missing = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        out.push(line);

        // CardDefinition literal: `    id: "<uuid>",` or `    id: CONST_ID,`
        const literalDef = line.match(/^(\s*)id: "([0-9a-f-]{30,})",\s*$/);
        const constDef = line.match(/^(\s*)id: ([A-Z_][A-Z0-9_]*),\s*$/);
        const defMatch =
            literalDef ??
            (constDef && constToId.has(constDef[2])
                ? [line, constDef[1], constToId.get(constDef[2])]
                : null);
        // CardPrint literal: `    setCode: "<code>",` (last field of the print)
        const printMatch = line.match(/^(\s*)setCode: "([a-z0-9]+)",\s*$/);

        if (defMatch) {
            const [, indent, id] = defMatch;
            // Skip if the block already declares rarity (idempotent).
            if (alreadyHasRarity(lines, i)) continue;
            const rarity = rarityByScryfall.get(id);
            if (!rarity) {
                missing.push(`DEF ${id}`);
                continue;
            }
            out.push(`${indent}rarity: "${rarity}",`);
            injected++;
        } else if (printMatch) {
            const [, indent] = printMatch;
            if (alreadyHasRarity(lines, i)) continue;
            // Resolve the print's rarity by its own printId, falling back to
            // the referenced definitionId (LEB == LEA).
            const printId = findFieldAbove(lines, i, "printId");
            const definitionId = findFieldAbove(lines, i, "definitionId");
            const rarity =
                (printId && rarityByScryfall.get(printId)) ??
                (definitionId && rarityByDefinitionId.get(definitionId));
            if (!rarity) {
                missing.push(`PRINT ${printId ?? "?"}`);
                continue;
            }
            out.push(`${indent}rarity: "${rarity}",`);
            injected++;
        }
    }

    writeFileSync(path, out.join("\n"), "utf-8");
    totalInjected += injected;
    summary.push(
        `${sf}.ts: +${injected}${missing.length ? ` (MISSING ${missing.length}: ${missing.slice(0, 5).join(", ")})` : ""}`
    );
}

console.log(summary.join("\n"));
console.log(`\nTotal rarity fields injected: ${totalInjected}`);

/** Looks at the few lines bracketing index `i` (same object literal) to see if
 *  a `rarity:` field is already present, so re-runs don't double-inject. */
function alreadyHasRarity(lines, i) {
    // Scan up to the opening `{` and down to the closing `}` of this literal.
    for (let j = i - 1; j >= 0 && j > i - 12; j--) {
        if (/[={]\s*$/.test(lines[j])) break;
        if (/^\s*rarity:/.test(lines[j])) return true;
    }
    for (let j = i + 1; j < lines.length && j < i + 12; j++) {
        if (/^\s*}/.test(lines[j])) break;
        if (/^\s*rarity:/.test(lines[j])) return true;
    }
    return false;
}

/** Finds `<field>: "<value>"` within the current object literal, searching the
 *  lines just above index `i` up to the opening brace. */
function findFieldAbove(lines, i, field) {
    const re = new RegExp(`^\\s*${field}: "([^"]+)"`);
    for (let j = i; j >= 0 && j > i - 12; j--) {
        const m = lines[j].match(re);
        if (m) return m[1];
        if (/export const .*= \{/.test(lines[j])) break;
    }
    return undefined;
}
