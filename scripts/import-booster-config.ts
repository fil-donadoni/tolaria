#!/usr/bin/env bun
/**
 * Repo-data importer: MTGJSON per-set booster config → checked-in Booster
 * Config (ADR 0056), same pattern as `backfill-rarity.mjs` — a re-runnable
 * script over the `data/json/<SET>.json` MTGJSON snapshots already vendored
 * in the repo, not a network fetch.
 *
 * Foil/variant slots are dropped and ADR 0010-excluded cards (Chaos Orb, the
 * ante trio) are stripped from the sheets with weights renormalized — both
 * handled by the pure transform in `convex/limited/mtgjsonImport.ts`. This
 * script is the thin I/O wrapper: read the MTGJSON file, call the transform,
 * write `data/boosters/<code>.json`. Deterministic — the same MTGJSON
 * snapshot always produces byte-identical output, so re-running is a no-op
 * diff.
 *
 * Usage:
 *   bun scripts/import-booster-config.ts <SETCODE> [boosterType]
 *
 *   bun scripts/import-booster-config.ts LEA          # booster."default"
 *   bun scripts/import-booster-config.ts INV draft    # booster."draft"
 *
 * `boosterType` selects which `booster.<key>` section of the MTGJSON file to
 * import (MTGJSON has no single canonical key across sets — old sets like
 * LEA use "default", others use "draft"/"play"/etc.) — defaults to
 * "default".
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
    buildBoosterConfig,
    type MtgjsonSetData,
} from "../convex/limited/mtgjsonImport";

const [, , setCodeArg, boosterTypeArg] = process.argv;
if (!setCodeArg) {
    console.error(
        "Usage: bun scripts/import-booster-config.ts <SETCODE> [boosterType]"
    );
    process.exit(1);
}

const setCode = setCodeArg.toUpperCase();
const boosterType = boosterTypeArg ?? "default";
const inPath = resolve(`data/json/${setCode}.json`);

if (!existsSync(inPath)) {
    console.error(
        `✗ import-booster-config: ${inPath} not found. Vendored MTGJSON snapshots live in data/json/ — add one before importing.`
    );
    process.exit(1);
}

const raw = JSON.parse(readFileSync(inPath, "utf-8"));
const setData = raw.data as MtgjsonSetData;

const config = buildBoosterConfig(setData, { boosterType });

const outPath = resolve(`data/boosters/${setCode.toLowerCase()}.json`);
writeFileSync(outPath, JSON.stringify(config, null, 4) + "\n", "utf-8");

const sheetCounts = Object.entries(config.sheets)
    .map(([name, sheet]) => `${name}=${Object.keys(sheet.cards).length}`)
    .join(", ");
console.log(
    `✓ wrote ${outPath} (${config.boosters.length} booster variant(s); sheets: ${sheetCounts})`
);
