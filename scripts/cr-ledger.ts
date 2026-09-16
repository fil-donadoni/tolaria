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
 *   bun run cr:ledger widen                 # record what a tokenizer change uncovered, as baseline
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
 * `widen` (issue #3697) is the one licensed growth, and it is NOT a bulk
 * `confirm`: everything it writes is `baseline`, i.e. explicitly unchecked.
 * It records the citations the CURRENT tokenizer sees on the MERGE-BASE tree
 * that the merge-base ledger lacks — citations that predate the branch and
 * were invisible, which only a tokenizer change can explain. It refuses when
 * `scripts/check-cr-citations.ts` is byte-identical to the merge-base's (no
 * change to explain anything) and when the changed tokenizer uncovers nothing
 * there. A line the branch edited is a new key the merge-base tree does not
 * make, so it is never entered; an entry the ledger already has is never
 * touched, whatever its status. `cr:lint` re-derives the same set from the
 * same diff and accepts a grown `baseline` entry only if it is in it.
 *
 * Everything here is offline: the vendored CR, the tracked tree, git.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    baseLedger,
    knownRuleIds,
    readSources,
    repoWidening,
    scanCitations,
    scannedFiles,
    TOKENIZER_PATH,
} from "./check-cr-citations.ts";
import {
    baselineSites,
    confirmLine,
    formatOpen,
    initialLedger,
    isExempt,
    LEDGER_PATH,
    ledgerReport,
    parseLedger,
    planWidening,
    pruneStale,
    serializeLedger,
    type Citation,
    type Ledger,
} from "./lib/cr-ledger.ts";
import { loadRules } from "./lib/cr-rules.ts";

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
    const base = baseLedger(ROOT);
    const report = ledgerReport({
        citations,
        ledger: readLedger(),
        rules: loadRules(),
        baseBaseline: base === null ? null : baselineSites(base.ledger),
        // The listing is for confirming; `cr:lint` is where a widening is
        // weighed, so a grown entry is listed as grown here.
        widened: null,
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
        // The full rule text AND the full line here — this listing IS the
        // reading a confirmation asserts, so nothing is elided.
        console.log(
            open.map((o) => formatOpen(o, Infinity, Infinity)).join("\n\n")
        );
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
            `\n${report.grown.length} baseline entr${report.grown.length === 1 ? "y" : "ies"} the base branch does not have — delete and confirm instead (\`cr:lint\` accepts the ones a tokenizer widening in this diff uncovered).`
        );
    return 0;
}

function cmdWiden(): number {
    const base = baseLedger(ROOT);
    if (base === null) {
        console.error(
            `refused: no base-branch ledger to measure a widening against — fetch the base branch first.`
        );
        return 1;
    }
    const { tokenizerChanged, widening, lost } = repoWidening(base, ROOT);
    const tree = treeCitationList();
    const plan = planWidening({
        tokenizerChanged,
        widening,
        lost,
        ledger: readLedger(),
        afterCitations: tree,
        ids: knownRuleIds(),
    });
    if (plan.kind === "refused") {
        console.error(`refused: ${plan.why}`);
        return 1;
    }
    const { ledger, pruned } = pruneStale(plan.ledger, tree);
    writeLedger(ledger);
    console.log(
        `${LEDGER_PATH}: ${plan.added.length} citation${plan.added.length === 1 ? "" : "s"} recorded as baseline (never checked) — ` +
            `uncovered on the merge-base tree (${base.mergeBase.slice(0, 12)}) by this diff's change to ${TOKENIZER_PATH}`
    );
    if (plan.alreadyRecorded)
        console.log(
            `  ${plan.alreadyRecorded} already recorded in this branch's ledger, left untouched`
        );
    if (plan.gone)
        console.log(`  ${plan.gone} no longer in the tree, not recorded`);
    if (plan.unresolvable.length) {
        console.log(
            `  ${plan.unresolvable.length} resolve to no rule and were NOT recorded — the existence scan reds on them; fix each on its line, then confirm it:`
        );
        for (const c of plan.unresolvable.slice(0, 25))
            console.log(
                `    ${c.sites[0].file}:${c.sites[0].line}  CR ${c.id}  ${c.line.slice(0, 120)}`
            );
        if (plan.unresolvable.length > 25)
            console.log(`    … ${plan.unresolvable.length - 25} more`);
    }
    if (pruned.length)
        console.log(
            `pruned ${pruned.length} stale entr${pruned.length === 1 ? "y" : "ies"}`
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
    if (isAbsolute(rel)) {
        console.error(
            `${rel}: paths are repo-relative (as \`cr:lint\` prints them).`
        );
        return 1;
    }
    if (isExempt(rel)) {
        console.error(`${rel} is exempt from the ledger — nothing to confirm.`);
        return 1;
    }
    // The tree scan sees tracked `SCANNED` files only; a line anywhere else
    // would be recorded and pruned again in the same write.
    if (!scannedFiles(ROOT).includes(rel)) {
        console.error(
            `${rel} is not a tracked source the citation scan reads — commit it (and keep a scanned extension) first.`
        );
        return 1;
    }
    const lines = readFileSync(join(ROOT, rel), "utf8").split("\n");
    const n = Number(lineNo);
    const raw = n >= 1 ? lines[n - 1] : undefined;
    if (raw === undefined) {
        console.error(
            `${rel}:${n}: no such line (lines are 1-based, as \`cr:lint\` prints them).`
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
    const tree = treeCitationList();
    const { ledger, confirmed } = confirmLine(
        readLedger(),
        citations,
        loadRules(),
        tree
    );
    const { ledger: pruned, pruned: dropped } = pruneStale(ledger, tree);
    writeLedger(pruned);
    for (const e of confirmed)
        console.log(
            `confirmed CR ${e.id} (${e.ruleHash}, ${e.sites} site${e.sites === 1 ? "" : "s"})  ${e.line.slice(0, 120)}`
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
            "  bun run cr:ledger widen                  record what this diff's tokenizer change uncovered, as baseline",
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
        case "widen":
            return cmdWiden();
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
