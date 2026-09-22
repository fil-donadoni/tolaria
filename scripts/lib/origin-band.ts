// The priority band of the work a `land` is closing (issue #4158) — what
// `gaps:sync --band` is told, so a gap born of P0 work files under its
// family's P0 umbrella instead of the umbrella its computed band names.
//
// The band is `effectivePriority` (`lib/queue-plan.ts`, issue #3212, issue
// #4371), the SAME rule `queue:plan` orders the queue by: the parent's board
// `Priority` when the parent carries one, else the issue's own — the parent
// governs, demotions included. Reusing it is the point — a second definition
// of "which band is this issue in" is how the partition and the queue would
// come to disagree about what P0 work is.
//
// NON-GATING by contract, like every other post-merge step of `land`: an
// unreadable board or parent is a `null` band plus a reason the caller prints,
// never a throw. `land` then runs `gaps:sync` without `--band`, which is
// exactly today's behaviour — the computed band stays the authority.

import { gh } from "./gh";
import { fetchBoardPriority, type BoardPriority } from "./board-priority";
import { effectivePriority } from "./queue-plan";
import type { IssueState } from "./orphans";

export interface OriginBand {
    /** The band, or null when none could be determined. */
    readonly band: BoardPriority | null;
    /** Why `band` is null — printed by the caller; absent when it is not. */
    readonly reason?: string;
}

/** A native parent edge, with the lifecycle that decides whether it governs
 *  the child's band at all (issue #4105). */
export interface ParentEdge {
    number: number;
    state: IssueState;
}

export interface OriginBandDeps {
    /** The issue's native parent edge, or null. May throw. */
    readParent: (issue: number) => ParentEdge | null;
    /** The board's `Priority` per issue number. May throw. */
    readBoard: () => Record<number, BoardPriority>;
}

/**
 * The band of `issue`. `null` with a reason when the issue has no board
 * priority of its own and no prioritised parent — an unprioritised issue is
 * legitimately bandless, which is different from a failed read and is told
 * apart in the reason.
 */
export function originBandOfIssue(
    issue: number,
    deps: OriginBandDeps
): OriginBand {
    let parent: ParentEdge | null;
    try {
        parent = deps.readParent(issue);
    } catch (err) {
        return {
            band: null,
            reason: `could not read the parent of issue #${issue} (${(err as Error).message})`,
        };
    }
    let board: Record<number, BoardPriority>;
    try {
        board = deps.readBoard();
    } catch (err) {
        return {
            band: null,
            reason: `could not read the board Priority (${(err as Error).message})`,
        };
    }
    // `parent` carries its own state, so a CLOSED umbrella degrades the band
    // to the issue's own value (issue #4105) instead of filing this landing's
    // gaps under a dead epic.
    const band = effectivePriority({ number: issue, parent }, board);
    return band === null
        ? {
              band: null,
              reason: `issue #${issue} and its parent carry no board Priority`,
          }
        : { band };
}

const PROJECT_OWNER = process.env.TOLARIA_PROJECT_OWNER ?? "fil-donadoni";
const PROJECT_NUMBER = process.env.TOLARIA_PROJECT_NUMBER ?? "2";
const PROJECT_REPO = process.env.TOLARIA_PROJECT_REPO ?? "fil-donadoni/tolaria";

/** The real reads: `gh` for the parent, the shared board reader for `Priority`. */
export const LIVE_ORIGIN_BAND_DEPS: OriginBandDeps = {
    readParent(issue) {
        // `state` rides along with the parent object the API already
        // returns — the band must know whether the umbrella is still open
        // (issue #4105), and asking for it costs no extra call.
        const raw = JSON.parse(
            gh(["issue", "view", String(issue), "--json", "parent"])
        ) as { parent?: { number: number; state?: string } | null };
        const parent = raw.parent;
        if (parent == null) return null;
        return {
            number: parent.number,
            state: parent.state === "CLOSED" ? "CLOSED" : "OPEN",
        };
    },
    readBoard() {
        return fetchBoardPriority({
            owner: PROJECT_OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: PROJECT_REPO,
            onError: (message) => {
                throw new Error(message.split("\n")[0]);
            },
        });
    },
};
