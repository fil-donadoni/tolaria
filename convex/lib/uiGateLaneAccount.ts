/**
 * The `check:ui` lane account's identity rules (issue #3626, PRD #3625).
 *
 * Every lane run registers its own throwaway account, grants it the roles the
 * walks need, and destroys it — with every row it owns — when the run ends.
 * Three of those steps are destructive or privileged, so each one refuses any
 * address that is not a lane address, and the privileged ones also refuse any
 * deployment that is not local. This module is the ONE definition of both
 * predicates, read by the Convex side (`convex/uiGateAccounts.ts`) and by the
 * lane (`scripts/ui-gate/lane-account.ts`): an address the lane mints is by
 * construction one the server accepts, and no second copy of the pattern can
 * drift wider than the first.
 *
 * DELIBERATELY DEPENDENCY-FREE, for the reason `limited/uiGateFixtureLabels.ts`
 * gives: a `scripts/` process importing a registered Convex function module
 * drags gitignored `convex/_generated` in with it.
 */

/** RFC 2606 reserves `.invalid`: no address here can ever route mail, so a
 *  lane account can never collide with — or be confused for — a real one. */
export const LANE_EMAIL_DOMAIN = "ui-gate.invalid";

/** The local part's fixed head. `+` sorts right before `,`, which is what makes
 *  `LANE_EMAIL_RANGE` a tight index range over exactly these addresses. */
export const LANE_EMAIL_HEAD = "ui-gate+";

/** A run id: 12 lowercase hex digits (48 random bits). Short enough to read in
 *  a label, wide enough that two concurrent runs never draw the same one. */
export const RUN_ID_PATTERN = /^[0-9a-f]{12}$/;

const LANE_EMAIL_PATTERN = /^ui-gate\+([0-9a-f]{12})@ui-gate\.invalid$/;

/** The `users.email` index range holding every lane address and nothing
 *  sorting outside it: `[head, head-with-last-char-bumped)`. The sweep narrows
 *  by this range and then re-checks each row with `isLaneAccountEmail`, so the
 *  range is a read bound, never the authority. */
export const LANE_EMAIL_RANGE = {
    gte: LANE_EMAIL_HEAD,
    lt: "ui-gate,",
} as const;

/** A lane account older than this is a run killed with no chance to clean up
 *  (SIGKILL, a crashed machine). The next run's bootstrap sweeps it. Two hours
 *  is several full runs, so a live run is never swept from under itself. */
export const LANE_ACCOUNT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export function isRunId(value: string): boolean {
    return RUN_ID_PATTERN.test(value);
}

export function laneAccountEmail(runId: string): string {
    if (!isRunId(runId)) {
        throw new Error(
            `"${runId}" is not a lane run id (12 lowercase hex digits)`
        );
    }
    return `${LANE_EMAIL_HEAD}${runId}@${LANE_EMAIL_DOMAIN}`;
}

export function isLaneAccountEmail(email: string | undefined): boolean {
    return email !== undefined && LANE_EMAIL_PATTERN.test(email);
}

/** The run id a lane address carries, or `null` for any other address. */
export function runIdOfLaneEmail(email: string): string | null {
    return LANE_EMAIL_PATTERN.exec(email)?.[1] ?? null;
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "0.0.0.0"]);

/**
 * Is this deployment URL a local backend?
 *
 * Read from `CONVEX_CLOUD_URL`, which Convex sets for every function it runs.
 * A missing or unparsable value answers `false`: the privileged lane functions
 * fail CLOSED, so a deployment that cannot say where it is gets no admin
 * minted on it.
 */
export function isLocalDeploymentUrl(url: string | undefined): boolean {
    if (!url) return false;
    try {
        return LOCAL_HOSTS.has(new URL(url).hostname);
    } catch {
        return false;
    }
}
