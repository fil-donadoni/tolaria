// The GitHub Project board's `Priority` single-select, read once and shared
// by every caller that needs it (issue #2519).
//
// This was `fetchBoardPriority`, private to `scripts/queue-plan.ts`, which
// FAILS LOUD on a degraded read (`die()` → exit 2): there, a silently
// mis-ordered batch is worse than a stopped loop. `loop:status` is the second
// caller this issue adds, and it is a read-only observability command — a
// missing `read:project` scope there must NOT crash the whole view, a
// missing priority column is cosmetic.
//
// So the failure policy is a PARAMETER, not a hard-coded `process.exit`:
// `onError` is invoked at every point the original inline version called
// `die()`, and what happens next is entirely the caller's choice. `queue:plan`
// passes its own `die` — so ITS behaviour (fail loud, exit 2, exact operator
// guidance) is unchanged by this extraction. `loop:status` passes a collector
// that degrades gracefully: render priorities as unknown, print one warning
// line, keep going.

import { gh } from "./gh";
import type { BoardPriority } from "./queue-plan";

export type { BoardPriority };

export const VALID_PRIORITIES: readonly BoardPriority[] = ["P0", "P1", "P2"];

export interface BoardPriorityOptions {
    owner: string;
    projectNumber: string;
    /** `owner/repo` — issue numbers are unique per repo, not per board. */
    repo: string;
    /** `gh project item-list` defaults to 30 and returns newest-first; this
     *  must be deep enough to see the WHOLE board (same silent-truncation
     *  trap `queue-plan.ts` documents for `gh issue list`). */
    itemLimit: number;
    /** Skip the read entirely (`queue:plan`'s `--no-priority` escape hatch). */
    skip?: boolean;
    /**
     * Called on every degraded/failed read, with an operator-facing message.
     * Returning normally means "continue in a degraded state" — what that
     * means is the caller's business: `die()` never returns, so nothing
     * after it runs; a collector returns and `fetchBoardPriority` degrades
     * (empty map, or skips just the one bad item) instead of aborting.
     */
    onError: (message: string) => void;
    /** Test seam — defaults to the real `gh` wrapper. */
    ghClient?: (args: string[]) => string;
}

interface ProjectItem {
    content?: { type?: string; number?: number; repository?: string };
    priority?: string;
}

export function fetchBoardPriority(
    opts: BoardPriorityOptions
): Record<number, BoardPriority> {
    const run = opts.ghClient ?? gh;

    if (opts.skip) {
        opts.onError(
            "--no-priority: board priorities NOT applied; this plan uses the default order only"
        );
        return {};
    }

    let raw: string;
    try {
        raw = run([
            "project",
            "item-list",
            opts.projectNumber,
            "--owner",
            opts.owner,
            "--format",
            "json",
            "--limit",
            String(opts.itemLimit),
        ]);
    } catch (err) {
        opts.onError(
            `cannot read project ${opts.owner}/${opts.projectNumber}: ${(err as Error).message}\n` +
                `  The board carries the Priority field the queue sorts on. Fix the access — \n` +
                `  \`gh auth refresh -s read:project\` — or re-run with --no-priority to plan on\n` +
                `  the default order deliberately.`
        );
        return {};
    }

    const items = (JSON.parse(raw) as { items?: ProjectItem[] }).items;
    if (!Array.isArray(items)) {
        opts.onError(
            "project item-list returned no `items` array — the CLI shape changed"
        );
        return {};
    }

    // A limit is a guess; `totalCount` is the answer.
    let total: { items?: { totalCount?: number } };
    try {
        total = JSON.parse(
            run([
                "project",
                "view",
                opts.projectNumber,
                "--owner",
                opts.owner,
                "--format",
                "json",
            ])
        ) as { items?: { totalCount?: number } };
    } catch (err) {
        opts.onError(
            `cannot confirm the project item count: ${(err as Error).message}`
        );
        return {};
    }
    const expected = total.items?.totalCount;
    if (typeof expected === "number" && items.length < expected) {
        opts.onError(
            `project item-list returned ${items.length} of ${expected} items — truncated.\n` +
                `  Raise the itemLimit passed to fetchBoardPriority.`
        );
        return {};
    }

    const priority: Record<number, BoardPriority> = {};
    for (const item of items) {
        if (item.priority === undefined) continue;
        if (item.content?.type !== "Issue") continue;
        // Issue numbers are unique per REPO, not per board. A board that ever
        // gains a second repo would otherwise map #42 of one onto #42 of the
        // other — wrong, and silent.
        if (item.content.repository !== opts.repo) continue;
        const number = item.content.number;
        if (typeof number !== "number") continue;
        if (!VALID_PRIORITIES.includes(item.priority as BoardPriority)) {
            opts.onError(
                `issue #${number} has Priority "${item.priority}", which is not one of ` +
                    `${VALID_PRIORITIES.join(", ")}. Treating an unknown value as "unprioritized"\n` +
                    `  would DEMOTE an issue someone deliberately flagged, so it is skipped rather\n` +
                    `  than silently reclassified — fix it on the board, or extend VALID_PRIORITIES.`
            );
            continue;
        }
        priority[number] = item.priority as BoardPriority;
    }
    return priority;
}
