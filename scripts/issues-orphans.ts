// `bun run issues:orphans` — every OPEN issue whose native parent is closed as
// `not planned` (issue #4105).
//
// The queue planner refuses to PICK one of these (`lib/queue-plan.ts`), which
// keeps a session from spending an hour on abandoned work — but a refusal
// leaves the issue sitting in the queue forever, re-refused on every pass.
// This is the other end: the sweep that drains them.
//
// READ-ONLY by default, `--close` opt-in. The whole premise of the refusal is
// that "open child of a `NOT_PLANNED` parent" now means exactly one thing, and
// that premise is a CONVENTION `/audit-tracker` upholds — a script that closed
// other people's issues the moment the convention slipped would be a much
// worse failure than the one it fixes. So the default prints, a human reads,
// and `--close` is a second decision.
//
// The classification itself is pure and tested (`lib/orphans.ts`); this file
// is argv, `gh` and printing.

import { gh } from "./lib/gh";
import {
    distinctParents,
    orphanCloseComment,
    orphanedIssues,
    partitionForClose,
    type Orphan,
    type ParentState,
    type SweepIssue,
} from "./lib/orphans";

/**
 * How many open issues to ask `gh` for.
 *
 * `gh issue list` paginates internally up to `--limit`, so this is the only
 * ceiling — and a ceiling that silently truncates is how a sweep reports "3
 * orphans" on a repo with 40. Well above the ~340 open issues measured on this
 * repo (2026-08-26), and `truncationWarning` below says so out loud whenever
 * the result comes back exactly full rather than leaving the reader to notice.
 */
const DEFAULT_LIMIT = 2000;

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

/** Non-empty when the listing came back exactly at its ceiling, which is
 *  indistinguishable from a truncated one. Pure so the wording is testable. */
export function truncationWarning(count: number, limit: number): string | null {
    return count < limit
        ? null
        : `⚠ the open-issue listing came back with exactly ${limit} rows — its ceiling. ` +
              `Some open issues may not have been examined; re-run with --limit ${limit * 2}.`;
}

function argNumber(name: string, fallback: number): number {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return fallback;
    const value = Number(process.argv[i + 1]);
    if (!Number.isFinite(value)) {
        console.error(`✗ --${name} needs a number`);
        process.exit(2);
    }
    return value;
}

function fetchOpenIssues(limit: number): SweepIssue[] {
    return JSON.parse(
        gh([
            "issue",
            "list",
            "--state",
            "open",
            "--json",
            // `parent` carries the parent's number and `state`; `stateReason`
            // is NOT on it, which is why the parents are resolved separately
            // below — once each, not once per child. `labels`/`assignees` are
            // the claim, which holds an orphan back from `--close`.
            "number,title,parent,labels,assignees",
            "--limit",
            String(limit),
        ]) || "[]"
    ) as SweepIssue[];
}

/** One `gh` round-trip per DISTINCT parent. A parent that cannot be read maps
 *  to `undefined` — "I don't know" — and `orphanedIssues` leaves its children
 *  alone, which is the only safe direction for a sweep that can close things. */
function resolveParents(numbers: number[]): Map<number, ParentState> {
    const out = new Map<number, ParentState>();
    for (const number of numbers) {
        try {
            const raw = JSON.parse(
                gh([
                    "issue",
                    "view",
                    String(number),
                    "--json",
                    "state,stateReason",
                ])
            ) as { state: string; stateReason: string | null };
            out.set(number, {
                state: raw.state === "CLOSED" ? "CLOSED" : "OPEN",
                stateReason:
                    raw.stateReason === "NOT_PLANNED" ||
                    raw.stateReason === "COMPLETED" ||
                    raw.stateReason === "REOPENED"
                        ? raw.stateReason
                        : null,
            });
        } catch (err) {
            console.error(
                `${YELLOW}⚠${RESET} could not read issue #${number} (${(err as Error).message.split("\n")[0]}) — its children are left alone`
            );
        }
    }
    return out;
}

function closeOrphan(orphan: Orphan): void {
    gh([
        "issue",
        "close",
        String(orphan.number),
        "--reason",
        "not planned",
        "--comment",
        orphanCloseComment(orphan),
    ]);
}

function main(): void {
    const limit = argNumber("limit", DEFAULT_LIMIT);
    const close = process.argv.includes("--close");

    const issues = fetchOpenIssues(limit);
    const warning = truncationWarning(issues.length, limit);
    if (warning) console.error(`${YELLOW}${warning}${RESET}`);

    // Only parents a child actually names, and only the ones the cheap list
    // already calls CLOSED: an OPEN parent can never be abandoned, so paying a
    // round-trip to confirm that is the whole queue's worth of calls for
    // nothing.
    const closedParents = distinctParents(
        issues.filter((i) => i.parent?.state === "CLOSED")
    );
    const parents = resolveParents(closedParents);
    const orphans = orphanedIssues(issues, (n) => parents.get(n));

    if (orphans.length === 0) {
        console.log(
            `${GREEN}✓${RESET} no orphans — every open issue's parent is open, or closed as completed ${DIM}(${issues.length} open issues, ${closedParents.length} closed parents resolved)${RESET}`
        );
        return;
    }

    console.log(
        `${BOLD}${orphans.length} orphan(s)${RESET} ${DIM}— open, under a parent closed as \`not planned\` (issue #4105)${RESET}\n`
    );
    const { closable, held } = partitionForClose(orphans);
    for (const orphan of orphans) {
        const claim = orphan.claim
            ? `  ${YELLOW}HELD — ${orphan.claim}${RESET}`
            : "";
        console.log(
            `  #${orphan.number}  ${orphan.title}${claim}\n    ${DIM}parent #${orphan.parent} — CLOSED / NOT_PLANNED${RESET}`
        );
    }

    if (held.length > 0) {
        console.log(
            `\n${YELLOW}${held.length} of these is held by a live claim${RESET} and will NOT be closed: the ` +
                `\`NOT_PLANNED\` parent is a convention, not a lock, and somebody may be working it right now. ` +
                `Reopen and re-parent it, or release the claim first.`
        );
    }

    if (!close) {
        console.log(
            `\n${DIM}read-only. Re-run with --close to close the unheld ones as \`not planned\` with a comment citing the parent;\n` +
                `a slice that is still live should be reopened and re-parented to an OPEN umbrella instead.${RESET}`
        );
        return;
    }

    console.log("");
    for (const orphan of closable) {
        try {
            closeOrphan(orphan);
            console.log(`  ${GREEN}✓${RESET} closed #${orphan.number}`);
        } catch (err) {
            console.error(
                `  ${YELLOW}⚠${RESET} #${orphan.number} — ${(err as Error).message.split("\n")[0]}`
            );
        }
    }
    for (const orphan of held) {
        console.log(
            `  ${YELLOW}·${RESET} left open #${orphan.number} ${DIM}(${orphan.claim})${RESET}`
        );
    }
}

if (import.meta.main) {
    main();
}
