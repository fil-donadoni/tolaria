#!/usr/bin/env node
/**
 * BACKFILL: populates the `oracleText` field on every CardDefinition in a card
 * set file by fetching the Oracle text from Scryfall.
 *
 * Both importers now emit `oracleText` at generation time (`json-to-cards.mjs`
 * from MTGJSON `text`, `list-to-cards.mjs` from the Scryfall print), so a
 * freshly imported set needs NO second pass. This script is for the catalogue
 * that predates that — a set file with definitions missing the field, or a
 * hand-written card whose author skipped it. It is idempotent, so running it
 * over an already-populated file is a no-op.
 *
 * Usage:
 *   node scripts/populate-oracle-text.mjs convex/cards/sets/lea.ts
 *
 * Behavior:
 *   - Scans the source file for every Scryfall UUID (active defs and
 *     commented-out stubs).
 *   - Batches /cards/collection POSTs (75 ids per call).
 *   - Inserts an `oracleText: "..."` line right after the `name: "..."`
 *     line of each block, mirroring the comment prefix and indent of the
 *     surrounding card definition.
 *   - Idempotent: skips blocks that already have an `oracleText:` line.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const filePath = process.argv[2];
if (!filePath) {
    console.error(
        "Usage: node scripts/populate-oracle-text.mjs <path-to-set.ts>"
    );
    process.exit(1);
}

const absPath = resolve(filePath);
const original = readFileSync(absPath, "utf-8");
const lines = original.split("\n");

const UUID_RE =
    /^(\s*)(\/\/\s*)?id:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/;

// Collect every card-definition block. Each block is anchored by the line
// containing `id: "<uuid>"` and we locate the subsequent `name:` line within
// the same block; the oracleText insertion lands right after `name:`.
const blocks = [];
for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(UUID_RE);
    if (!m) continue;
    const [, indent, commentPrefix, uuid] = m;
    const nameIdx = findNameLine(i, indent, commentPrefix ?? "");
    if (nameIdx === -1) continue;
    if (blockAlreadyHasOracleText(i, indent, commentPrefix ?? "")) continue;
    blocks.push({
        uuid,
        indent,
        commentPrefix: commentPrefix ?? "",
        idLine: i,
        nameLine: nameIdx,
    });
}

console.log(`Found ${blocks.length} blocks needing oracleText.`);

// --- Scryfall fetch ---

const oracleByUuid = new Map();
const BATCH = 75;
for (let i = 0; i < blocks.length; i += BATCH) {
    const slice = blocks.slice(i, i + BATCH);
    const identifiers = slice.map((b) => ({ id: b.uuid }));
    const res = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "tolaria-populate-oracle/1.0",
        },
        body: JSON.stringify({ identifiers }),
    });
    if (!res.ok) {
        console.error(
            `Scryfall request failed (${res.status}): ${await res.text()}`
        );
        process.exit(1);
    }
    const data = await res.json();
    for (const card of data.data ?? []) {
        const text = extractOracleText(card);
        if (text != null) oracleByUuid.set(card.id, text);
    }
    for (const missing of data.not_found ?? []) {
        console.warn(`Scryfall not_found: ${JSON.stringify(missing)}`);
    }
    // Scryfall asks for ~50–100ms between requests; be polite.
    await sleep(120);
}

console.log(`Fetched oracle text for ${oracleByUuid.size}/${blocks.length}.`);

// --- Splice insertions back into the source ---

// Process in reverse so earlier insertion offsets remain valid.
const sortedBlocks = [...blocks].sort((a, b) => b.nameLine - a.nameLine);
let inserted = 0;
for (const block of sortedBlocks) {
    const oracle = oracleByUuid.get(block.uuid);
    if (oracle == null) continue;
    const insertAt = block.nameLine + 1;
    lines.splice(
        insertAt,
        0,
        `${block.indent}${block.commentPrefix}oracleText: ${JSON.stringify(oracle)},`
    );
    inserted++;
}

console.log(`Inserted oracleText into ${inserted} blocks.`);

writeFileSync(absPath, lines.join("\n"), "utf-8");
console.log(`Wrote ${absPath}`);

// --- helpers ---

function findNameLine(idIdx, indent, commentPrefix) {
    const want = new RegExp(
        `^${escapeRe(indent)}${escapeRe(commentPrefix)}name:\\s*"`
    );
    // Search forward up to 6 lines (typical block has id, name adjacent).
    for (let j = idIdx + 1; j < Math.min(idIdx + 6, lines.length); j++) {
        if (want.test(lines[j])) return j;
    }
    return -1;
}

function blockAlreadyHasOracleText(idIdx, indent, commentPrefix) {
    const want = new RegExp(
        `^${escapeRe(indent)}${escapeRe(commentPrefix)}oracleText:`
    );
    // Look ahead until block close (`};` at outer indent) or 60 lines.
    const closeIndent = indent.length === 0 ? "" : indent.slice(0, -4);
    const closeRe = new RegExp(
        `^${escapeRe(closeIndent)}${escapeRe(commentPrefix)}\\};`
    );
    for (let j = idIdx + 1; j < Math.min(idIdx + 60, lines.length); j++) {
        if (want.test(lines[j])) return true;
        if (closeRe.test(lines[j])) return false;
    }
    return false;
}

function extractOracleText(card) {
    if (typeof card.oracle_text === "string" && card.oracle_text.length > 0) {
        return card.oracle_text;
    }
    if (Array.isArray(card.card_faces) && card.card_faces.length > 0) {
        return card.card_faces
            .map((f) => f.oracle_text ?? "")
            .filter((s) => s.length > 0)
            .join("\n//\n");
    }
    return null;
}

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
