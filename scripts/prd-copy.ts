#!/usr/bin/env bun
/**
 * `bun run prd:copy <N>` — PRD hygiene BY COPY (issue #3851 decision 6).
 *
 * A PRD whose children are mostly closed parks its live slices behind a wall
 * of delivered work: the umbrella reads as "nearly done", the lineage sort
 * sees one big epic, and nobody can tell what is left without opening every
 * sub-issue. Editing the body in place would destroy the record of what was
 * actually delivered, so this opens a NEW PRD carrying only the still-open
 * children, re-parents those onto the copy, and closes the original — which
 * is then genuinely at 100%.
 *
 * The copy keeps the original's parent, labels and board `Priority`, so the
 * lineage sort sees no discontinuity and the band does not reset. Only OPEN
 * children move — a closed child stays under the original, because that is
 * the record. Each body gets a pointer to the other, so neither is orphaned
 * in the history.
 *
 * Refuses a PRD with no closed children: there is nothing to clean, and a
 * copy would only add an umbrella.
 *
 * `--dry-run` prints the plan and writes nothing.
 *
 * Runs from the primary checkout with `GITHUB_TOKEN` stripped (`lib/gh.ts`).
 */

import { gh, setIssueParent, subIssueCount } from "./lib/gh";
import { fetchBoardPriority, type BoardPriority } from "./lib/board-priority";
import { isIssueNotFound } from "./gaps-sync";

const PROJECT_OWNER = process.env.TOLARIA_PROJECT_OWNER ?? "fil-donadoni";
const PROJECT_NUMBER = process.env.TOLARIA_PROJECT_NUMBER ?? "2";
const PROJECT_REPO = process.env.TOLARIA_PROJECT_REPO ?? "fil-donadoni/tolaria";

export interface PrdChild {
    readonly number: number;
    readonly state: "OPEN" | "CLOSED";
}

export interface PrdIssue {
    readonly number: number;
    readonly title: string;
    readonly body: string;
    readonly state: "OPEN" | "CLOSED";
    readonly labels: readonly string[];
    readonly parent: number | null;
    readonly children: readonly PrdChild[];
}

/** Everything this command touches on the tracker — narrow, and stubbed in
 *  tests exactly like `gaps:sync`'s `GapTracker` (`lib/gap-issues.ts`). */
export interface PrdTracker {
    /** null when the issue does not exist. */
    getIssue(number: number): PrdIssue | null;
    createIssue(input: {
        title: string;
        body: string;
        labels: readonly string[];
    }): number;
    updateBody(number: number, body: string): void;
    /** Confirmed parent edge — same retry contract as `lib/gh.ts`'s
     *  `setIssueParent`. */
    setParent(child: number, parent: number): boolean;
    closeIssue(number: number, comment: string): void;
    /** How many sub-issues `parent` holds right now. */
    subIssueCount(parent: number): number;
    /** The board's `Priority` on `number`, or null when unset/unreadable. */
    getPriority(number: number): BoardPriority | null;
    setPriority(number: number, priority: BoardPriority): void;
}

export interface PrdCopyPlan {
    readonly original: number;
    readonly title: string;
    readonly labels: readonly string[];
    readonly parent: number | null;
    readonly openChildren: readonly number[];
    readonly closedChildren: readonly number[];
}

export interface PrdCopyRefusal {
    readonly refused: string;
}

/** The pure decision: which children move, and whether there is anything to
 *  clean at all. No network — `getIssue`'s shape is the whole input. */
export function planCopy(issue: PrdIssue): PrdCopyPlan | PrdCopyRefusal {
    const openChildren = issue.children
        .filter((c) => c.state === "OPEN")
        .map((c) => c.number);
    const closedChildren = issue.children
        .filter((c) => c.state === "CLOSED")
        .map((c) => c.number);
    if (closedChildren.length === 0) {
        return {
            refused:
                `issue #${issue.number} has no closed children — nothing to clean, ` +
                "a copy would only add an umbrella",
        };
    }
    return {
        original: issue.number,
        title: issue.title,
        labels: issue.labels,
        parent: issue.parent,
        openChildren,
        closedChildren,
    };
}

export function isRefusal(
    plan: PrdCopyPlan | PrdCopyRefusal
): plan is PrdCopyRefusal {
    return "refused" in plan;
}

/** The copy's body: the original's content, plus a pointer BACK to it. */
export function buildCopyBody(originalBody: string, original: number): string {
    return (
        `${originalBody}\n\n---\n\n` +
        `**Continued from issue #${original}** — PRD hygiene by copy (issue #3851 ` +
        "decision 6): only the still-open children moved here; closed children " +
        "stay on the original."
    );
}

/** The original's body, unchanged except for a pointer FORWARD to the copy —
 *  never rewritten: the record of what was delivered survives verbatim. */
export function appendCopyPointer(originalBody: string, copy: number): string {
    return (
        `${originalBody}\n\n---\n\n` +
        `**Continued in issue #${copy}** — PRD hygiene by copy: open children ` +
        "moved there, closed children stay here."
    );
}

export interface PrdCopyResult {
    readonly copy: number;
}

/**
 * Drives the plan through a `PrdTracker`. Order matters:
 *
 * 1. create the copy (body already points back — the original's number is
 *    known before anything is written)
 * 2. re-parent the copy onto the original's own parent (a SIBLING of the
 *    original, never its child)
 * 3. carry the board `Priority` over, when the original had one
 * 4. re-parent every open child onto the copy
 * 5. verify the copy's sub-issue count equals the number moved — a mismatch
 *    means an edge silently failed to confirm, and closing the original
 *    would orphan a child that never actually moved
 * 6. point the original at the copy, then close it
 *
 * The original is only closed once every re-parent is confirmed — a throw
 * before that leaves the original open with the copy sitting beside it,
 * which is a safe, re-runnable state (the closed-children refusal in
 * `planCopy` will not fire again since the original still holds its closed
 * children either way, but a human re-running `prd:copy` sees a PRD with a
 * copy already pointing at it and stops there instead of the tool creating a
 * second one).
 */
export function runCopy(
    tracker: PrdTracker,
    plan: PrdCopyPlan,
    originalBody: string
): PrdCopyResult {
    const copy = tracker.createIssue({
        title: plan.title,
        body: buildCopyBody(originalBody, plan.original),
        labels: plan.labels,
    });

    if (plan.parent !== null) {
        if (!tracker.setParent(copy, plan.parent)) {
            throw new Error(
                `prd:copy: could not confirm issue #${copy}'s parent is #${plan.parent} — ` +
                    `the copy exists but is not yet re-parented; the original was not closed`
            );
        }
    }

    const priority = tracker.getPriority(plan.original);
    if (priority !== null) tracker.setPriority(copy, priority);

    for (const child of plan.openChildren) {
        if (!tracker.setParent(child, copy)) {
            throw new Error(
                `prd:copy: could not confirm issue #${child}'s parent is #${copy} — ` +
                    `the original was not closed; re-run once the edge is fixed`
            );
        }
    }

    const moved = tracker.subIssueCount(copy);
    if (moved !== plan.openChildren.length) {
        throw new Error(
            `prd:copy: issue #${copy} holds ${moved} sub-issue(s), expected ${plan.openChildren.length} — ` +
                "the original was not closed; re-run once the edges are confirmed"
        );
    }

    tracker.updateBody(plan.original, appendCopyPointer(originalBody, copy));
    tracker.closeIssue(
        plan.original,
        `PRD hygiene by copy — open work continues at issue #${copy}.`
    );

    return { copy };
}

/** The `gh`-backed `PrdTracker` — the one place this module touches the
 *  network. */
class GhPrdTracker implements PrdTracker {
    getIssue(number: number): PrdIssue | null {
        let out: string;
        try {
            out = gh([
                "issue",
                "view",
                String(number),
                "--json",
                "number,title,body,state,labels,parent,subIssues",
            ]);
        } catch (err) {
            if (isIssueNotFound(err)) return null;
            throw err;
        }
        const raw = JSON.parse(out) as {
            number: number;
            title: string;
            body: string;
            state: "OPEN" | "CLOSED";
            labels: { name: string }[];
            parent?: { number: number } | null;
            subIssues: {
                nodes: { number: number; state: "OPEN" | "CLOSED" }[];
            };
        };
        return {
            number: raw.number,
            title: raw.title,
            body: raw.body,
            state: raw.state,
            labels: raw.labels.map((l) => l.name),
            parent: raw.parent?.number ?? null,
            children: raw.subIssues.nodes.map((n) => ({
                number: n.number,
                state: n.state,
            })),
        };
    }

    createIssue(input: {
        title: string;
        body: string;
        labels: readonly string[];
    }): number {
        const args = [
            "issue",
            "create",
            "--title",
            input.title,
            "--body",
            input.body,
        ];
        for (const label of input.labels) args.push("--label", label);
        const url = gh(args).trim();
        const m = /\/issues\/(\d+)\s*$/.exec(url);
        if (m === null) {
            throw new Error(
                `prd:copy: could not read an issue number back from \`gh issue create\`: ${JSON.stringify(url)}`
            );
        }
        return Number(m[1]);
    }

    updateBody(number: number, body: string): void {
        gh(["issue", "edit", String(number), "--body", body]);
    }

    setParent(child: number, parent: number): boolean {
        return setIssueParent(child, parent);
    }

    closeIssue(number: number, comment: string): void {
        gh(["issue", "close", String(number), "--comment", comment]);
    }

    subIssueCount(parent: number): number {
        return subIssueCount(parent);
    }

    getPriority(number: number): BoardPriority | null {
        const priority = fetchBoardPriority({
            owner: PROJECT_OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: PROJECT_REPO,
            onError: (message) => console.error(`prd:copy: ${message}`),
        });
        return priority[number] ?? null;
    }

    setPriority(number: number, priority: BoardPriority): void {
        const url = `https://github.com/${PROJECT_REPO}/issues/${number}`;
        gh([
            "project",
            "item-add",
            PROJECT_NUMBER,
            "--owner",
            PROJECT_OWNER,
            "--url",
            url,
        ]);
        gh([
            "project",
            "item-edit",
            PROJECT_NUMBER,
            "--owner",
            PROJECT_OWNER,
            "--url",
            url,
            "--field",
            "Priority",
            "--value",
            priority,
        ]);
    }
}

function printPlan(plan: PrdCopyPlan, priority: BoardPriority | null): void {
    console.log(`prd:copy --dry-run: issue #${plan.original}`);
    console.log(`  title:    ${plan.title}`);
    console.log(
        `  parent:   ${plan.parent === null ? "none" : `#${plan.parent}`}`
    );
    console.log(`  labels:   ${plan.labels.join(", ") || "none"}`);
    console.log(`  priority: ${priority ?? "none"}`);
    console.log(
        `  moving:   ${plan.openChildren.length ? plan.openChildren.map((n) => `#${n}`).join(", ") : "none"}`
    );
    console.log(
        `  staying:  ${plan.closedChildren.map((n) => `#${n}`).join(", ")}`
    );
    console.log("prd:copy --dry-run: 0 writes");
}

function main(): void {
    const args = process.argv.slice(2);
    const dryRun = args.includes("--dry-run");
    const numArg = args.find((a) => /^\d+$/.test(a));
    if (numArg === undefined) {
        console.error("usage: bun run prd:copy <issue#> [--dry-run]");
        process.exit(1);
    }
    const number = Number(numArg);

    const tracker = new GhPrdTracker();
    const issue = tracker.getIssue(number);
    if (issue === null) {
        console.error(`prd:copy: issue #${number} not found`);
        process.exit(1);
    }

    const plan = planCopy(issue);
    if (isRefusal(plan)) {
        console.error(`prd:copy: refused — ${plan.refused}`);
        process.exit(1);
    }

    if (dryRun) {
        printPlan(plan, tracker.getPriority(number));
        return;
    }

    const result = runCopy(tracker, plan, issue.body);
    console.log(
        `prd:copy: issue #${number} closed, ${plan.openChildren.length} open ` +
            `child(ren) moved to issue #${result.copy}`
    );
}

if (import.meta.main) main();
