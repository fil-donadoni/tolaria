#!/usr/bin/env node
/**
 * Detects card definitions whose `id` was populated with `scryfallOracleId`
 * instead of `scryfallId` (an old import bug). Matches each card def to its
 * MTGJSON entry by name and compares.
 *
 * Usage: node scripts/check-scryfall-ids.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SETS = [
    ["arn", "data/json/ARN.json"],
    ["atq", "data/json/ATQ.json"],
    ["drk", "data/json/DRK.json"],
    ["lea", "data/json/LEA.json"],
    ["leg", "data/json/LEG.json"],
];

const mismatches = [];

for (const [code, jsonPath] of SETS) {
    const raw = JSON.parse(readFileSync(resolve(jsonPath), "utf-8"));
    const cards = raw.data.cards;

    // name -> { scryfallId, scryfallOracleId }
    const byName = new Map();
    for (const c of cards) {
        if (!byName.has(c.name)) {
            byName.set(c.name, {
                scryfallId: c.identifiers?.scryfallId,
                scryfallOracleId: c.identifiers?.scryfallOracleId,
            });
        }
    }

    const tsPath = resolve(`convex/cards/sets/${code}.ts`);
    const src = readFileSync(tsPath, "utf-8");

    // Match blocks: id: "..."  ... name: "..."  (name follows id by project convention)
    const re = /id:\s*"([0-9a-f-]{36})"\s*,\s*\n\s*name:\s*"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const id = m[1];
        const name = m[2].replace(/\\"/g, '"');
        const entry = byName.get(name);
        if (!entry) continue; // not in this JSON (rename/token) — skip
        if (id === entry.scryfallId) continue; // correct
        if (id === entry.scryfallOracleId) {
            mismatches.push({ code, name, wrong: id, correct: entry.scryfallId });
        } else {
            // id matches neither — flag for manual review
            mismatches.push({
                code,
                name,
                wrong: id,
                correct: entry.scryfallId,
                note: "id matches NEITHER scryfallId nor scryfallOracleId",
            });
        }
    }
}

if (mismatches.length === 0) {
    console.log("No scryfall id mismatches found.");
} else {
    console.log(`Found ${mismatches.length} mismatched card id(s):\n`);
    for (const x of mismatches) {
        console.log(
            `[${x.code}] ${x.name}\n  wrong:   ${x.wrong}\n  correct: ${x.correct}${x.note ? `\n  NOTE: ${x.note}` : ""}\n`
        );
    }
}
