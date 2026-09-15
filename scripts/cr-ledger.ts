#!/usr/bin/env bun
/**
 * The CR citation ledger's recording command (ADR 0133, issue #3674) — the
 * one writer of `data/cr/citations-ledger.json`, OUTSIDE the gate.
 *
 * `bun run cr:lint` reds on a citation the ledger does not record; this is
 * how a reader records it. The discipline is in the shape of the command:
 *
 *   bun run cr:ledger                       # every open citation, each beside the printed rule
 *   bun run cr:ledger confirm <file>:<line> # record the citations on THAT line as confirmed
 *   bun run cr:ledger prune                 # drop entries no line in the tree makes any more
 *   bun run cr:ledger init                  # the one-off baseline; refuses if the ledger exists
 *
 * `confirm` takes exactly one `file:line` — there is no bulk form, no glob,
 * no `--all`. A confirmation asserts that a reader printed the cited rule and
 * checked that the line says what it says; a loop over open citations would
 * assert that about lines nobody read. A citation that turns out to be wrong
 * is fixed ON ITS LINE first, then confirmed under its new id — the edited
 * line is a new citation, so the old entry goes stale and `prune` (which every
 * write also runs) drops it.
 *
 * `init` records every citation in the tree as `baseline` — never checked —
 * and only for a tree with no ledger yet. Once committed, that set can only
 * shrink (`cr:lint` compares it with the base branch's), so `init` cannot be
 * used to grow it: delete-and-reinit shows up as a grown baseline in the very
 * PR that does it.
 *
 * Everything here is offline: the vendored CR, the tracked tree, git.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    baseBaselineKeys,
    knownRuleIds,
    readSources,
    scanCitations,
} from "./check-cr-citations.ts";
import {
    confirmLine,
    formatOpen,
    initialLedger,
    isExempt,
    LEDGER_PATH,
    ledgerReport,
    parseLedger,
    pruneStale,
    serializeLedger,
    type Citation,
    type Ledger,
} from "./lib/cr-ledger.ts";
import { loadRules } from "./lib/cr-rules.ts";
import { SUPPRESS } from "./lib/cr-misattribution.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER_ABS = join(ROOT, LEDGER_PATH);

function readLedger(): Ledger {
    if (!existsSync(LEDGER_ABS)) {
        throw new Error(
            `${LEDGER_PATH} does not exist — \`bun run cr:ledger init\` creates the baseline once`
        );
    }
    return parseLedger(readFileSync(LEDGER_ABS, "utf8"));
}

function writeLedger(ledger: Ledger): void {
    writeFileSync(LEDGER_ABS, serializeLedger(ledger));
}

/** Every citation the tree makes, through the existence scan's tokenizer. */
function treeCitationList(): Citation[] {
    return scanCitations(readSources(ROOT), knownRuleIds()).citations;
}

function cmdList(): number {
    const citations = treeCitationList();
    const report = ledgerReport({
        citations,
        ledger: readLedger(),
        rules: loadRules(),
        baseBaselineKeys: baseBaselineKeys(ROOT),
    });
    const open = [...report.unrecorded, ...report.drifted];
    console.log(
        `${report.recorded} citations recorded; ${open.length} open, ${report.stale.length} stale, ${report.grown.length} grown-baseline`
    );
    if (!open.length) {
        console.log("nothing to confirm");
    } else {
        console.log(
            `\nEach open citation, beside the rule it cites (\`bun run cr <id>\` prints it whole):\n`
        );
        // The full rule text here — this listing IS the reading a confirmation
        // asserts, so nothing is elided.
        console.log(open.map((o) => formatOpen(o, Infinity)).join("\n\n"));
        console.log(
            `\nConfirm one line at a time: bun run cr:ledger confirm <file>:<line>`
        );
    }
    if (report.stale.length)
        console.log(
            `\n${report.stale.length} stale entr${report.stale.length === 1 ? "y" : "ies"} — \`bun run cr:ledger prune\` drops them.`
        );
    if (report.grown.length)
        console.log(
            `\n${report.grown.length} baseline entr${report.grown.length === 1 ? "y" : "ies"} the base branch does not have — delete and confirm instead.`
        );
    return 0;
}

const SITE = /^(.+?):(\d+)$/;

function cmdConfirm(args: string[]): number {
    if (args.length !== 1 || !SITE.test(args[0])) {
        console.error(
            `usage: bun run cr:ledger confirm <file>:<line>\n` +
                `One line per call — a confirmation asserts the rule was printed and checked against THAT line.`
        );
        return 2;
    }
    const [, file, lineNo] = args[0].match(SITE) as RegExpMatchArray;
    const rel = file.replace(/^\.\//, "");
    if (isExempt(rel)) {
        console.error(`${rel} is exempt from the ledger — nothing to confirm.`);
        return 1;
    }
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) {
        console.error(`${rel}: no such file.`);
        return 1;
    }
    const lines = readFileSync(abs, "utf8").split("\n");
    const n = Number(lineNo);
    const raw = lines[n - 1];
    if (raw === undefined) {
        console.error(`${rel}:${n}: past the end of the file.`);
        return 1;
    }
    if (raw.includes(SUPPRESS)) {
        console.error(
            `${rel}:${n} carries \`${SUPPRESS}\` — a suppressed line needs no entry.`
        );
        return 1;
    }
    // Scan exactly this line, as the tree scan would see it.
    const { citations, bad } = scanCitations(
        [{ file: rel, text: raw }],
        knownRuleIds()
    );
    if (!citations.length) {
        console.error(`${rel}:${n} cites no CR rule:\n    ${raw.trim()}`);
        return 1;
    }
    if (bad.size) {
        console.error(
            `${rel}:${n} cites ${[...bad.keys()].map((id) => `CR ${id}`).join(", ")}, which resolve to nothing — ` +
                `fix the citation first (\`bun run cr grep "<keyword>"\`).`
        );
        return 1;
    }
    const rules = loadRules();
    const { ledger, confirmed } = confirmLine(readLedger(), citations, rules);
    const { ledger: pruned, pruned: dropped } = pruneStale(
        ledger,
        treeCitationList()
    );
    writeLedger(pruned);
    for (const e of confirmed)
        console.log(
            `confirmed CR ${e.id} (${e.ruleHash})  ${e.line.slice(0, 120)}`
        );
    if (dropped.length)
        console.log(
            `pruned ${dropped.length} stale entr${dropped.length === 1 ? "y" : "ies"}`
        );
    return 0;
}

function cmdPrune(): number {
    const { ledger, pruned } = pruneStale(readLedger(), treeCitationList());
    writeLedger(ledger);
    console.log(
        pruned.length
            ? `pruned ${pruned.length} stale entr${pruned.length === 1 ? "y" : "ies"}:\n` +
                  pruned
                      .map((e) => `  CR ${e.id}  ${e.line.slice(0, 120)}`)
                      .join("\n")
            : "nothing stale"
    );
    return 0;
}

function cmdInit(): number {
    if (existsSync(LEDGER_ABS)) {
        console.error(
            `${LEDGER_PATH} already exists — the baseline is generated once and only shrinks.\n` +
                `Confirm open citations one line at a time: bun run cr:ledger confirm <file>:<line>`
        );
        return 1;
    }
    const ledger = initialLedger(treeCitationList());
    writeLedger(ledger);
    console.log(
        `${LEDGER_PATH}: ${ledger.entries.length} citations recorded as baseline (never checked)`
    );
    return 0;
}

function usage(): number {
    console.error(
        [
            "usage:",
            "  bun run cr:ledger                        list open citations with their rules",
            "  bun run cr:ledger confirm <file>:<line>  record that line's citations as confirmed",
            "  bun run cr:ledger prune                  drop entries no line makes any more",
            "  bun run cr:ledger init                   one-off baseline (refuses if the ledger exists)",
        ].join("\n")
    );
    return 2;
}

function main(): number {
    const [cmd, ...rest] = process.argv.slice(2);
    switch (cmd) {
        case undefined:
        case "list":
            return cmdList();
        case "confirm":
            return cmdConfirm(rest);
        case "prune":
            return cmdPrune();
        case "init":
            return cmdInit();
        default:
            return usage();
    }
}

if (import.meta.main) {
    try {
        process.exit(main());
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
}
