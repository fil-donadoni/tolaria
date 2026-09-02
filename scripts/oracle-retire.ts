#!/usr/bin/env bun
/**
 * `bun run oracle:retire <card name> --issue <N> [--pr <N>] [--date <YYYY-MM-DD>]`
 *
 * The retirement tooling: the ONE writer of `data/oracle-retirements.json`
 * (issue #3049, ADR 0114 §1). A marker is written by a tool and not by hand so
 * that the two things a hand-written entry gets wrong cannot happen: an oracle
 * id that names no card (the marker then guards nothing, silently) and an id
 * that names the WRONG card (the marker guards someone else's row). Both are
 * refused here against the pinned corpus, and refused again at compile time by
 * `stampRetirements` for the ledger that arrives through a merge rather than
 * through this command.
 *
 * It does NOT delete the hand-written module — that is the retirement's own
 * work (issue #2703), and this records that the work happened. It does not
 * regenerate the lockfile either: regeneration needs the gitignored corpus and
 * the gate is offline by contract, so this prints the one command to run next
 * and `bun run check:oracle` reds until it has been run.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readCorpus, type CorpusCard } from "./oracle-corpus";
import {
    addRetirement,
    emptyRetirementLedger,
    parseRetirementLedger,
    serializeRetirementLedger,
    validateRetirementLedger,
    RETIREMENT_LEDGER_PATH,
    type RetirementEntry,
} from "./lib/oracle-retirements";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const LEDGER_PATH = join(ROOT, RETIREMENT_LEDGER_PATH);

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export interface RetireArgs {
    /** Card name or oracle id — whichever the caller has to hand. */
    readonly subject: string;
    readonly issue: number;
    readonly pr?: number;
    readonly date?: string;
}

/** Pure arg parsing, so the CLI's one decision is testable without a corpus. */
export function parseRetireArgs(argv: readonly string[]): RetireArgs {
    const positional: string[] = [];
    let issue: number | undefined;
    let pr: number | undefined;
    let date: string | undefined;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--issue") issue = Number(argv[++i]);
        else if (arg === "--pr") pr = Number(argv[++i]);
        else if (arg === "--date") date = argv[++i];
        else positional.push(arg);
    }
    const subject = positional.join(" ").trim();
    if (subject === "") {
        throw new Error(
            "usage: bun run oracle:retire <card name|oracle id> --issue <N> [--pr <N>] [--date YYYY-MM-DD]"
        );
    }
    if (issue === undefined || !Number.isInteger(issue) || issue <= 0) {
        throw new Error(
            "--issue <N> is required: a retirement records WHICH issue's equivalence proof authorised it"
        );
    }
    return {
        subject,
        issue,
        ...(pr === undefined ? {} : { pr }),
        ...(date === undefined ? {} : { date }),
    };
}

/**
 * The corpus card a subject names, by oracle id or by exact name.
 *
 * Exact rather than fuzzy on purpose: "Lightning Bolt" and "Lightning Bolt //
 * …" are different cards, and a tool that guesses would write a marker onto a
 * row nobody meant to mark.
 */
export function resolveSubject(
    corpus: readonly CorpusCard[],
    subject: string
): CorpusCard {
    const byId = corpus.find((c) => c.oracleId === subject);
    if (byId) return byId;
    const byName = corpus.filter((c) => c.name === subject);
    if (byName.length === 1) return byName[0];
    if (byName.length === 0) {
        throw new Error(
            `no card in the pinned corpus is named "${subject}" (and it is not an oracle id) — ` +
                `check the spelling against \`bun run oracle:report\``
        );
    }
    throw new Error(
        `"${subject}" names ${byName.length} corpus rows — pass the oracle id instead: ` +
            byName.map((c) => c.oracleId).join(", ")
    );
}

function today(): string {
    return new Date().toISOString().slice(0, 10);
}

function main(): void {
    let args: RetireArgs;
    try {
        args = parseRetireArgs(process.argv.slice(2));
    } catch (err) {
        process.stderr.write(
            `${RED}✗ oracle:retire — ${(err as Error).message}${RESET}\n`
        );
        process.exit(1);
    }

    const card = resolveSubject(readCorpus(), args.subject);
    const entry: RetirementEntry = {
        oracleId: card.oracleId,
        name: card.name,
        retiredAt: args.date ?? today(),
        issue: args.issue,
        ...(args.pr === undefined ? {} : { pr: args.pr }),
    };

    const ledger = existsSync(LEDGER_PATH)
        ? parseRetirementLedger(readFileSync(LEDGER_PATH, "utf8"))
        : emptyRetirementLedger();
    const next = addRetirement(ledger, entry);
    const problems = validateRetirementLedger(next);
    if (problems.length > 0) {
        process.stderr.write(
            `${RED}✗ oracle:retire — the entry would make ${RETIREMENT_LEDGER_PATH} malformed:${RESET}\n` +
                problems.map((p) => `    ${p}\n`).join("")
        );
        process.exit(1);
    }
    writeFileSync(LEDGER_PATH, serializeRetirementLedger(next));

    process.stdout.write(
        `${GREEN}✓ oracle:retire${RESET} ${card.name} (${card.oracleId}) — ` +
            `retired ${entry.retiredAt} under issue #${entry.issue}\n` +
            `${DIM}  next: bun run oracle:compile   # stamps the marker onto the row; check:oracle reds until you do${RESET}\n`
    );
}

if (import.meta.main) {
    main();
}
