#!/usr/bin/env node
/**
 * Detects card definitions whose `id` was populated with `scryfallOracleId`
 * instead of `scryfallId` (an old import bug). Matches each card def to its
 * MTGJSON entry by name and compares.
 *
 * Usage: node scripts/check-scryfall-ids.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

/** Reads a set's TypeScript source. A set is either a single `sets/<code>.ts`
 *  file or, post-ADR-0043 colour split, a `sets/<code>/` directory whose colour
 *  modules are concatenated (index.ts barrel skipped — it only re-exports). */
function readSetSource(code) {
    const filePath = resolve(`convex/cards/sets/${code}.ts`);
    if (existsSync(filePath) && statSync(filePath).isFile()) {
        return readFileSync(filePath, "utf-8");
    }
    const dirPath = resolve(`convex/cards/sets/${code}`);
    return readdirSync(dirPath)
        .filter((f) => f.endsWith(".ts") && f !== "index.ts")
        .map((f) => readFileSync(join(dirPath, f), "utf-8"))
        .join("\n");
}

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

    const src = readSetSource(code);

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
    console.log("✓ scryfall ids: no mismatches");
} else {
    console.error(`✗ scryfall ids: ${mismatches.length} mismatched card id(s):\n`);
    for (const x of mismatches) {
        console.error(
            `[${x.code}] ${x.name}\n  wrong:   ${x.wrong}\n  correct: ${x.correct}${x.note ? `\n  NOTE: ${x.note}` : ""}\n`
        );
    }
    console.error(
        "Each card def `id` must equal the JSON `identifiers.scryfallId` " +
            "(NOT scryfallOracleId). Run with the corrections above."
    );
    process.exit(1);
}
