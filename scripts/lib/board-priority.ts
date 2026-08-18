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
//
// `--no-priority` is the ONE exception to "every degraded read goes through
// `onError`" (PR #2545 review, finding 1). Skipping the board read on purpose
// is not a failure — it is the documented escape hatch for exactly the case
// `onError` exists to report (a board that cannot be read). Routing it through
// `onError` anyway made `queue:plan --no-priority` call `die()` on its own
// deliberate skip and exit 2, which deleted the escape hatch it was invoked
// to use. So the skip branch warns UNCONDITIONALLY, itself, and never calls
// `onError` — the caller's failure policy (fail-loud `die`, or a degrading
// collector) never sees it and cannot abort on it.

// The READ is here; the CACHE is not (issue #2520). Sizing the window and
// proving it wasn't truncated are properties of the read itself, so they live
// here and every caller gets them. Whether a failed read may degrade to a
// stale snapshot is a failure POLICY — same class as `onError` — so it lives
// in the caller: `queue:plan` wraps this function in its own file-backed
// cache, `loop:status` caches the value it gets in its own server route.

import { gh } from "./gh";
import type { BoardPriority } from "./queue-plan";

export type { BoardPriority };

export const VALID_PRIORITIES: readonly BoardPriority[] = ["P0", "P1", "P2"];

/** The `--no-priority` skip's own message — exported so a caller that wants
 *  to report the same warning WITHOUT making the (skipped) call at all, e.g.
 *  `loop:status`'s `fetchPriorityGracefully`, doesn't have to duplicate the
 *  string. */
export const NO_PRIORITY_WARNING =
    "--no-priority: board priorities NOT applied; this plan uses the default order only";

export interface BoardPriorityOptions {
    owner: string;
    projectNumber: string;
    /** `owner/repo` — issue numbers are unique per repo, not per board. */
    repo: string;
    /** FALLBACK limit, used only when the board's own `totalCount` cannot be
     *  read (issue #2520). The read is normally sized by `computeItemLimit`
     *  from that count, because `--limit 2000` on a 411-item board pages far
     *  past the end and every page is a GraphQL round trip. Keep it deep
     *  enough to see the WHOLE board anyway — `gh project item-list` defaults
     *  to 30 and returns newest-first (the same silent-truncation trap
     *  `queue-plan.ts` documents for `gh issue list`). */
    itemLimit: number;
    /** Skip the read entirely (`queue:plan`'s `--no-priority` escape hatch). */
    skip?: boolean;
    /**
     * Called on every degraded/failed READ (a genuine failure — bad scope,
     * truncated list, unrecognized priority value), with an operator-facing
     * message. Returning normally means "continue in a degraded state" —
     * what that means is the caller's business: `die()` never returns, so
     * nothing after it runs; a collector returns and `fetchBoardPriority`
     * degrades (empty map, or skips just the one bad item) instead of
     * aborting.
     *
     * NOT called for the deliberate `--no-priority` skip (`opts.skip`) — see
     * the module comment. That path warns on its own and never reaches this
     * callback, so a `die`-style `onError` cannot turn the escape hatch into
     * an abort.
     */
    onError: (message: string) => void;
    /** Test seam — defaults to the real `gh` wrapper. */
    ghClient?: (args: string[]) => string;
}

interface ProjectItem {
    content?: { type?: string; number?: number; repository?: string };
    priority?: string;
}

/**
 * Headroom added on top of the board's own `totalCount` when sizing
 * `item-list --limit` (issue #2520). `gh project item-list --limit N` returns
 * the N NEWEST items, not the first N — so a limit sized to EXACTLY
 * `totalCount` silently drops the OLDEST items (which can carry a P0) the
 * moment the board grows in the gap between the `project view` (totalCount)
 * call and the `item-list` call. Headroom absorbs ordinary growth in that
 * gap; `isPossiblyTruncated` still catches growth that outpaces it.
 */
export const ITEM_LIMIT_HEADROOM = 50;

/**
 * Size the `item-list --limit` to the board's own `totalCount` (plus
 * `ITEM_LIMIT_HEADROOM`) instead of a static guess — `--limit 2000` on a
 * 411-item board pages far past the end, and every page is a GraphQL round
 * trip, on a budget several sessions share (issue #2520). Falls back only
 * when `totalCount` itself could not be read (unknown/non-numeric shape).
 *
 * The headroom exists because `totalCount` is read a moment BEFORE
 * `item-list` runs: sizing the limit to exactly `totalCount` means a board
 * that grows in that gap gets its OLDEST items silently dropped by `gh`
 * (which returns the newest `limit` items, not the first `limit`). See
 * `isPossiblyTruncated` for the guard that still fires when growth outpaces
 * the headroom.
 */
export function computeItemLimit(
    totalCount: number | undefined,
    fallback: number
): number {
    if (
        typeof totalCount !== "number" ||
        !Number.isFinite(totalCount) ||
        totalCount <= 0
    ) {
        return fallback;
    }
    return totalCount + ITEM_LIMIT_HEADROOM;
}

/**
 * Whether an `item-list --limit N` read may have been truncated.
 *
 * `gh project item-list --limit N` returns the N NEWEST items when the board
 * has more than N — never the first N. That means the only safe signal is
 * whether the response FILLED the requested window: `itemsLength >= limit`
 * means the read cannot prove the oldest items weren't cut, while a response
 * strictly under the limit proves it saw everything the board had. Gate on
 * the window, never on comparing back to the `totalCount` read a moment
 * earlier — `totalCount` itself can be stale by the time `item-list` runs, so
 * a `< totalCount` check fires in the harmless direction (board shrank) and
 * is structurally unable to fire in the harmful one (board grew): the exact
 * inversion issue #2520 found and fixed.
 */
export function isPossiblyTruncated(
    itemsLength: number,
    limit: number
): boolean {
    return itemsLength >= limit;
}

export function fetchBoardPriority(
    opts: BoardPriorityOptions
): Record<number, BoardPriority> {
    const run = opts.ghClient ?? gh;

    if (opts.skip) {
        // Deliberately NOT `opts.onError` — see the module comment. `--no-
        // priority` is the documented escape hatch, not a failure, so it must
        // warn and return regardless of the caller's error policy (`die` for
        // `queue:plan` would otherwise exit(2) on its own escape hatch).
        console.warn(`⚠ ${NO_PRIORITY_WARNING}`);
        return {};
    }

    // A static limit is a guess; the board's own `totalCount` is the answer —
    // and it is read FIRST, because it is what sizes the item-list window
    // (issue #2520). `opts.itemLimit` survives only as the fallback for a
    // count that cannot be read.
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
    const limit = computeItemLimit(expected, opts.itemLimit);

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
            String(limit),
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

    // `gh` returns the NEWEST `limit` items when the board has more than
    // `limit` — never the first `limit` — so hitting the ceiling exactly is
    // the only signal that the read may have silently dropped the OLDEST
    // items (issue #2520: a `< expected` check here fires only in the
    // harmless direction and can never catch the harmful one).
    if (isPossiblyTruncated(items.length, limit)) {
        opts.onError(
            `project item-list returned ${items.length} items — at or above the sized limit (${limit}),\n` +
                `  so the read cannot prove nothing was truncated. The board likely grew past the\n` +
                `  ${typeof expected === "number" ? `${expected}-item` : "expected"} count taken a moment earlier — re-run the read.`
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
