#!/usr/bin/env bun
/**
 * `bun run oracle:report` — the per-format state of the Oracle compiler.
 *
 * Reads the LOCKFILE, never the corpus. That is deliberate: the lockfile is the
 * committed artefact, so the report is reproducible on a clean checkout with no
 * network and no 24 MB cache, and two people quoting a number are quoting the
 * same run (PRD #2693 user story 6).
 *
 * Usage:
 *   bun scripts/oracle-report.ts             # per-format table + top fragments
 *   bun scripts/oracle-report.ts --gaps 50   # more of the fragment backlog
 *   bun scripts/oracle-report.ts --decks     # per-deck, per-card state (M1)
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { REPORTED_FORMATS } from "./oracle-corpus";
import { poolOracleIds } from "./oracle-compile";
import { parseLockfile } from "./lib/oracle-lockfile";
import {
    readTier1Decks,
    summaryLine,
    tier1Reports,
    TIER1_DECKS_PATH,
    type DeckCardRow,
} from "./lib/tier1-decks";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const LOCKFILE_PATH = join(ROOT, "data", "oracle-compiled.json");

function pct(n: number, total: number): string {
    return total === 0
        ? "  0.0%"
        : `${((n / total) * 100).toFixed(1).padStart(5)}%`;
}

const BLOCKER_COLUMN = 54;

/** `unparsed  3x  Gempalm Incinerator   Cycling {2}{R} (…)` */
function cardLine(card: DeckCardRow): string {
    const slot = card.slot === "both" ? " (main+side)" : "";
    const head =
        `  ${card.state.padEnd(11)}${`${card.copies}x`.padStart(3)}  ` +
        `${card.name}${slot}`;
    if (card.blocker === undefined) return head;
    const blocker =
        card.blocker.length > 60
            ? `${card.blocker.slice(0, 57)}...`
            : card.blocker;
    return `${head.padEnd(BLOCKER_COLUMN)}${blocker}`;
}

/**
 * The per-deck section (PRD #2693 user story 8): M1's "done" as a checklist,
 * one line per card, so a deck that is not 100% names exactly what is missing.
 */
function reportDecks(lock: ReturnType<typeof parseLockfile>): void {
    const file = readTier1Decks(ROOT);
    const reports = tier1Reports(file, lock, poolOracleIds());

    process.stdout.write(
        `\nPremodern Tier 1 — per-deck card state\n` +
            `lists supplied by the ${file.source.supplier} ${file.source.suppliedOn}, ` +
            `stored verbatim in ${TIER1_DECKS_PATH}\n\n`
    );
    for (const report of reports) {
        process.stdout.write(`${summaryLine(report)}\n`);
    }

    const presets = file.shippedPresets
        .map((p) => `${p.slug} (${p.name})`)
        .join(", ");
    process.stdout.write(
        `\nAlready shipped as Preset Decks, every card hand-written by construction: ${presets}\n` +
            `Their lists live in the \`presetDecks\` table (ADR 0033) and are referenced by slug only —\n` +
            `copying them here would be a second source of truth for a deck an Admin can edit.\n`
    );

    for (const report of reports) {
        process.stdout.write(
            `\n${`${report.slug} — ${report.name}`.padEnd(BLOCKER_COLUMN)}` +
                `${report.playable}/${report.total} ready\n`
        );
        for (const card of report.cards) {
            process.stdout.write(`${cardLine(card)}\n`);
        }
    }
    process.stdout.write("\n");
}

function main(): void {
    if (!existsSync(LOCKFILE_PATH)) {
        process.stderr.write(
            "data/oracle-compiled.json missing — run: bun run oracle:compile\n"
        );
        process.exit(1);
    }
    const lock = parseLockfile(readFileSync(LOCKFILE_PATH, "utf8"));
    if (process.argv.includes("--decks")) {
        reportDecks(lock);
        return;
    }
    const gapsAt = process.argv.indexOf("--gaps");
    const requested = gapsAt === -1 ? NaN : Number(process.argv[gapsAt + 1]);
    const gapCount =
        Number.isFinite(requested) && requested > 0 ? requested : 20;

    const { corpus, counts, grammarVersion } = lock.header;
    process.stdout.write(
        `\nOracle compiler — grammar ${grammarVersion}\n` +
            `corpus ${corpus.downloadUri.split("/").pop()} (Scryfall updated_at ${corpus.updatedAt})\n\n`
    );

    process.stdout.write(
        `${"format".padEnd(12)}${"total".padStart(8)}${"ready".padStart(9)}${"quar".padStart(9)}` +
            `${"unparsed".padStart(11)}${"pool".padStart(9)}\n`
    );
    process.stdout.write(`${"-".repeat(58)}\n`);
    for (const format of REPORTED_FORMATS) {
        const row = lock.formats[format];
        if (row === undefined) continue;
        process.stdout.write(
            `${format.padEnd(12)}${String(row.total).padStart(8)}` +
                `${String(row.ready).padStart(9)}${String(row.quarantine).padStart(9)}` +
                `${String(row.unparsed).padStart(11)}${String(row.pool).padStart(9)}\n` +
                `${"".padEnd(12)}${"".padStart(8)}${pct(row.ready, row.total).padStart(9)}` +
                `${pct(row.quarantine, row.total).padStart(9)}${pct(row.unparsed, row.total).padStart(11)}` +
                `${pct(row.pool, row.total).padStart(9)}\n`
        );
    }
    process.stdout.write(
        `\ncorpus     ${counts.total} cards: ${counts.ready} ready, ` +
            `${counts.quarantine} quarantine, ${counts.unparsed} unparsed\n`
    );
    process.stdout.write(
        `\n"pool" is the cards already covered by a HAND-WRITTEN definition today.\n` +
            `It is the baseline the compiler is measured against, not part of its output.\n`
    );

    process.stdout.write(
        `\nTop ${gapCount} unconsumed fragments (the grammar backlog):\n`
    );
    for (const fragment of lock.fragments.slice(0, gapCount)) {
        const text =
            fragment.text.length > 78
                ? `${fragment.text.slice(0, 75)}...`
                : fragment.text;
        process.stdout.write(
            `  ${String(fragment.cards).padStart(5)}  ${text}\n`
        );
    }
    process.stdout.write("\n");
}

if (import.meta.main) {
    main();
}
