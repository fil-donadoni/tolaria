#!/usr/bin/env bun
/**
 * `bun run combos:import` — projects the Commander Spellbook bulk export onto
 * the catalogue and writes `data/combos/corpus.json` (ADR 0164 § 1, issue
 * #8416). The rules are `scripts/lib/combo-corpus.ts`.
 *
 * Usage:
 *   bun run combos:import                  # downloads the export (~730 MB)
 *   bun run combos:import --from <path>    # reads a local copy of it
 *
 * Explicit by contract: gates, `build`, `dev` and `worktree:init` are offline,
 * so none of them reaches this script (`combo-corpus-seam.test.ts`). Parsing
 * the export holds about 2 GB of memory for the length of the run.
 */

import {
    createWriteStream,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import {
    projectComboCorpus,
    serializeComboCorpus,
    SPELLBOOK_EXPORT_URL,
    SPELLBOOK_SITE,
    type SpellbookExport,
} from "./lib/combo-corpus";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const CARD_INDEX_PATH = join(ROOT, "data", "card-index.json");
export const COMBO_CORPUS_PATH = join(ROOT, "data", "combos", "corpus.json");

/** Spellbook asks API clients to identify themselves (`data/combos/README.md`). */
const USER_AGENT =
    "tolaria-combo-corpus-import/1.0 (+https://github.com/fil-donadoni/tolaria)";

export interface ImportArgs {
    readonly from: string | null;
}

export function parseImportArgs(argv: readonly string[]): ImportArgs {
    if (argv.length === 0) return { from: null };
    if (argv.length === 2 && argv[0] === "--from" && argv[1])
        return { from: argv[1] };
    throw new Error(
        `usage: bun run combos:import [--from <path>], got: ${argv.join(" ")}`
    );
}

async function downloadExport(dest: string): Promise<void> {
    const response = await fetch(SPELLBOOK_EXPORT_URL, {
        headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok || !response.body)
        throw new Error(
            `${SPELLBOOK_EXPORT_URL} answered ${response.status} ${response.statusText}`
        );
    await pipeline(
        Readable.fromWeb(response.body as NodeWebStream),
        createWriteStream(dest)
    );
}

function readCatalogueOracleIds(): Set<string> {
    const rows = JSON.parse(readFileSync(CARD_INDEX_PATH, "utf8")) as {
        readonly oracleId: string;
    }[];
    return new Set(rows.map((row) => row.oracleId));
}

function writeCorpus(dump: SpellbookExport): void {
    const projection = projectComboCorpus(
        dump.variants,
        readCatalogueOracleIds()
    );
    // An upstream rename reads as "nothing joins": refuse it here, or the
    // import would replace the corpus with an empty file.
    if (projection.combos.length === 0)
        throw new Error(
            "no variant survived the projection: the export's shape has changed, corpus left untouched"
        );
    mkdirSync(dirname(COMBO_CORPUS_PATH), { recursive: true });
    writeFileSync(
        COMBO_CORPUS_PATH,
        serializeComboCorpus(
            {
                name: "Commander Spellbook",
                site: SPELLBOOK_SITE,
                export: SPELLBOOK_EXPORT_URL,
                exportTimestamp: dump.timestamp,
                exportVersion: dump.version,
            },
            projection
        )
    );
    const { counts } = projection;
    console.log(`upstream:               ${counts.upstream}`);
    console.log(`kept:                   ${counts.kept}`);
    console.log(`dropped by status:      ${counts.droppedByStatus}`);
    console.log(`dropped by catalogue:   ${counts.droppedByCatalogue}`);
    console.log(`dropped by template:    ${counts.droppedByTemplate}`);
    console.log(`dropped by piece count: ${counts.droppedByPieceCount}`);
}

async function main(): Promise<void> {
    const { from } = parseImportArgs(process.argv.slice(2));
    const tempDir = from ? null : mkdtempSync(join(tmpdir(), "combos-import-"));
    try {
        const path = from ?? join(tempDir as string, "variants.json");
        if (!from) {
            console.log(`downloading ${SPELLBOOK_EXPORT_URL}`);
            await downloadExport(path);
        }
        writeCorpus(JSON.parse(readFileSync(path, "utf8")) as SpellbookExport);
    } finally {
        if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    }
}

if (import.meta.main) await main();
