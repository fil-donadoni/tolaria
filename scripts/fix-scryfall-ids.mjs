#!/usr/bin/env node
/**
 * Fixes card definitions whose `id` was populated with `scryfallOracleId`
 * (or a fabricated placeholder UUID) instead of the real `scryfallId`.
 *
 * Builds wrong->correct pairs by matching each card def to its MTGJSON entry
 * by name, then replaces every literal occurrence of the wrong id across the
 * source tree (so deck presets / tests that reference the id stay consistent).
 *
 * Usage: node scripts/fix-scryfall-ids.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, extname } from "node:path";

const DRY = process.argv.includes("--dry");

const SETS = [
    ["arn", "data/json/ARN.json"],
    ["atq", "data/json/ATQ.json"],
    ["drk", "data/json/DRK.json"],
    ["lea", "data/json/LEA.json"],
    ["leg", "data/json/LEG.json"],
];

// ── build wrong->correct map ─────────────────────────────────────────────────
const fixes = new Map(); // wrongId -> { correct, name, code }

for (const [code, jsonPath] of SETS) {
    const raw = JSON.parse(readFileSync(resolve(jsonPath), "utf-8"));
    const byName = new Map();
    for (const c of raw.data.cards) {
        if (!byName.has(c.name)) {
            byName.set(c.name, {
                scryfallId: c.identifiers?.scryfallId,
                scryfallOracleId: c.identifiers?.scryfallOracleId,
            });
        }
    }
    const src = readFileSync(resolve(`convex/cards/sets/${code}.ts`), "utf-8");
    const re = /id:\s*"([0-9a-f-]{36})"\s*,\s*\n\s*name:\s*"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const id = m[1];
        const name = m[2].replace(/\\"/g, '"');
        const entry = byName.get(name);
        if (!entry || !entry.scryfallId) continue;
        if (id === entry.scryfallId) continue;
        fixes.set(id, { correct: entry.scryfallId, name, code });
    }
}

console.log(`${fixes.size} id(s) to fix.`);

// ── walk source tree and apply ───────────────────────────────────────────────
const ROOTS = ["convex", "src"];
const SKIP_DIRS = new Set(["node_modules", "_generated"]);
const EXTS = new Set([".ts", ".tsx"]);

function walk(dir, out) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) {
            if (SKIP_DIRS.has(name)) continue;
            walk(p, out);
        } else if (EXTS.has(extname(name))) {
            out.push(p);
        }
    }
}

const files = [];
for (const r of ROOTS) walk(resolve(r), files);

let totalReplacements = 0;
const touched = [];

for (const file of files) {
    let content = readFileSync(file, "utf-8");
    let fileCount = 0;
    for (const [wrong, { correct }] of fixes) {
        if (content.includes(wrong)) {
            const n = content.split(wrong).length - 1;
            content = content.split(wrong).join(correct);
            fileCount += n;
        }
    }
    if (fileCount > 0) {
        totalReplacements += fileCount;
        touched.push([file, fileCount]);
        if (!DRY) writeFileSync(file, content, "utf-8");
    }
}

console.log(`\n${totalReplacements} replacement(s) across ${touched.length} file(s)${DRY ? " (dry run)" : ""}:`);
for (const [f, n] of touched) console.log(`  ${n.toString().padStart(3)}  ${f.replace(resolve(".") + "/", "")}`);
