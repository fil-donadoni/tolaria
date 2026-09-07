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

// The READ is here; the CACHE is not (issue #2520). Proving the read was not
// truncated is a property of the read itself, so it lives here and every
// caller gets it. Whether a failed read may degrade to a stale snapshot is a
// failure POLICY — same class as `onError` — so it lives in the caller:
// `queue:plan` wraps this function in its own file-backed cache,
// `loop:status` caches the value it gets in its own server route.
//
// ── Why this is a raw GraphQL query and not `gh project item-list` ──────────
//
// `gh project item-list` asks for EVERY field value of every item, and
// GitHub prices a GraphQL call by the nodes it touches. Measured against
// this board (705 items) on 2026-09-07:
//
//     gh project view + item-list (what this used to do)   →  766 points
//     the query below, paginated to completion             →    8 points
//
// Both runs, back to back against the same board, returned the SAME 351
// issue→priority entries — identical keys, identical values.
//
// The pool is 5000 points per HOUR, shared by every session and script on
// the machine. At 768 a read it affords 6.5 board reads an hour in total,
// which is how the account reached `graphql 0/5000 remaining` with the REST
// pool untouched at 5000/5000 and `loop:status` reporting every `gh`-backed
// section UNAVAILABLE at once. At 7 it affords ~700.
//
// Two things follow from asking directly rather than through `gh project`:
//
//  - **No owner-type lookup.** `gh project` first resolves whether the owner
//    is a user or an organization, and when THAT call is rate-limited it
//    reports `unknown owner type` — a message that reads as a configuration
//    error and sent one investigation looking at `gh auth status`. The
//    inline fragment on `ProjectV2Owner` covers both kinds in one query, so
//    there is nothing to look up and nothing to mis-report.
//  - **No window to size.** `item-list --limit N` returns the N NEWEST items
//    when the board holds more, so the limit had to be sized from a separate
//    `project view` totalCount read, with headroom, plus a guard for the
//    board growing in the gap between the two (issue #2520). Cursor
//    pagination has no such failure mode: pages are walked to completion and
//    `hasNextPage` says so exactly. `computeItemLimit`, `ITEM_LIMIT_HEADROOM`
//    and `isPossiblyTruncated` are gone with the bug they guarded — what
//    survives is the guard below, which fires if pagination stopped with
//    pages still outstanding.

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

/** One `items.nodes[]` entry of the query below. `content` is a union — a
 *  draft item has no `number`, a pull-request item is a different
 *  `__typename` — and `fieldValueByName` is `null` when the item has no
 *  Priority set (and `{}` when the field exists but is not a single-select,
 *  which the inline fragment simply does not match). */
interface ProjectItemNode {
    content?: {
        __typename?: string;
        number?: number;
        repository?: { nameWithOwner?: string };
    } | null;
    fieldValueByName?: { name?: string } | null;
}

interface BoardPage {
    data?: {
        repositoryOwner?: {
            projectV2?: {
                items?: {
                    totalCount?: number;
                    pageInfo?: { hasNextPage?: boolean };
                    nodes?: ProjectItemNode[];
                };
            } | null;
        } | null;
    };
}

/** The board field this module exists to read. */
const PRIORITY_FIELD = "Priority";

/**
 * `repositoryOwner` rather than `user`/`organization` so one query covers
 * both kinds of owner — `ProjectV2Owner` is the interface they share, and
 * picking the wrong one of the two is precisely what `gh project`'s
 * owner-type lookup exists to avoid (and what it mis-reports as `unknown
 * owner type` when rate-limited).
 *
 * `$endCursor` is named exactly that because `gh api graphql --paginate`
 * requires it: gh feeds `pageInfo.endCursor` back into a variable of that
 * name and stops when `hasNextPage` goes false. Renaming it silently reads
 * ONE page — the first 100 items — and every older item's priority
 * disappears, which is why the pagination test drives two pages.
 */
const BOARD_PRIORITY_QUERY = `
query($owner: String!, $number: Int!, $endCursor: String) {
  repositoryOwner(login: $owner) {
    ... on ProjectV2Owner {
      projectV2(number: $number) {
        items(first: 100, after: $endCursor) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes {
            content {
              __typename
              ... on Issue { number repository { nameWithOwner } }
            }
            fieldValueByName(name: "${PRIORITY_FIELD}") {
              ... on ProjectV2ItemFieldSingleSelectValue { name }
            }
          }
        }
      }
    }
  }
}`;

/**
 * Whether pagination stopped with pages still outstanding.
 *
 * The bug this replaces (issue #2520) was a property of `item-list --limit
 * N`: it returns the N NEWEST items when the board holds more, so a window
 * sized a moment earlier from `project view`'s `totalCount` could silently
 * drop the OLDEST items — one of which can carry a P0 — and the only usable
 * signal was the coarse "did the response FILL the window".
 *
 * Cursor pagination has no window and no ordering trap: `gh api graphql
 * --paginate` walks pages until `hasNextPage` is false, so the read either
 * completed or it did not, and the LAST page says which. Anything still
 * outstanding there means gh stopped early (its own page cap, a partial
 * error), and a partial board is exactly the thing that must not be treated
 * as the whole one.
 */
export function isTruncated(pages: BoardPage[]): boolean {
    const last = pages[pages.length - 1];
    return (
        last?.data?.repositoryOwner?.projectV2?.items?.pageInfo?.hasNextPage ===
        true
    );
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

    let raw: string;
    try {
        raw = run([
            "api",
            "graphql",
            // gh drives the cursor itself and emits ONE response per page;
            // `--slurp` collects them into a single JSON array so the shape
            // is the same whether the board fits in one page or eight.
            "--paginate",
            "--slurp",
            "-F",
            `owner=${opts.owner}`,
            // `-F` (not `-f`): the query declares `$number: Int!`, and a
            // string there is a type error, not a coercion.
            "-F",
            `number=${opts.projectNumber}`,
            "-f",
            `query=${BOARD_PRIORITY_QUERY}`,
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

    const pages = JSON.parse(raw) as BoardPage[];
    if (!Array.isArray(pages) || pages.length === 0) {
        opts.onError(
            "the board query returned no pages — `gh api graphql --paginate --slurp` shape changed"
        );
        return {};
    }

    // An owner or a project that does not resolve comes back as `null` DATA
    // with a zero exit, not as an error — so the `catch` above never sees it.
    // Returning `{}` silently here would render as "nobody prioritised
    // anything", which is the queue reading a wrong order as a real one.
    const items = pages.map(
        (page) => page.data?.repositoryOwner?.projectV2?.items
    );
    if (items.some((it) => !Array.isArray(it?.nodes))) {
        opts.onError(
            `project ${opts.owner}/${opts.projectNumber} returned no items — the owner, the project\n` +
                `  number or the \`Priority\` field does not resolve. Check them, or re-run with\n` +
                `  --no-priority to plan on the default order deliberately.`
        );
        return {};
    }

    // Cursor pagination either completed or it did not, and the last page
    // says which — see `isTruncated`. A partial board must never be treated
    // as the whole one: the items pagination has not reached are the OLDEST,
    // and one of them can carry a P0.
    if (isTruncated(pages)) {
        const seen = items.reduce((n, it) => n + (it?.nodes?.length ?? 0), 0);
        opts.onError(
            `the board read stopped after ${seen} of ${items[0]?.totalCount ?? "?"} items with more\n` +
                `  pages outstanding, so it cannot prove nothing was missed — re-run the read.`
        );
        return {};
    }

    const nodes = items.flatMap((it) => it!.nodes!);

    const priority: Record<number, BoardPriority> = {};
    for (const node of nodes) {
        // `null` when the item has no Priority set — not an error, and not
        // routed through `onError`: most of the board is unprioritized.
        const value = node.fieldValueByName?.name;
        if (value === undefined) continue;
        if (node.content?.__typename !== "Issue") continue;
        // Issue numbers are unique per REPO, not per board. A board that ever
        // gains a second repo would otherwise map #42 of one onto #42 of the
        // other — wrong, and silent.
        if (node.content.repository?.nameWithOwner !== opts.repo) continue;
        const number = node.content.number;
        if (typeof number !== "number") continue;
        if (!VALID_PRIORITIES.includes(value as BoardPriority)) {
            opts.onError(
                `issue #${number} has Priority "${value}", which is not one of ` +
                    `${VALID_PRIORITIES.join(", ")}. Treating an unknown value as "unprioritized"\n` +
                    `  would DEMOTE an issue someone deliberately flagged, so it is skipped rather\n` +
                    `  than silently reclassified — fix it on the board, or extend VALID_PRIORITIES.`
            );
            continue;
        }
        priority[number] = value as BoardPriority;
    }
    return priority;
}
