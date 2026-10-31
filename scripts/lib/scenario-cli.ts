// The pure decisions behind `bun run scenario:ls` / `scenario:rm`
// (issue #3331, reshaped by issue #3333).
//
// These live on the SCRIPT side, not in `convex/debugScenarioSpec.ts`, because
// nothing on the server calls them: `ls` reads whole rows back from the
// existing admin query `listDebugScenarios` and does its own projecting; `rm`
// resolves ids through the label index (`scenarioIdLookup`, issue #7702). `debugScenarioSpec.ts` carries the decisions the MUTATIONS act on
// (`selectScenarioUpsert`, `selectEphemeralIdsToPrune`); putting a CLI-only
// concern there would make the server module grow logic no server path reaches.

/** A stored row, as the admin query returns it. Only the fields the CLI reads
 *  are declared — the query returns the whole document, `spec` included. */
export type StoredScenarioRow = {
    _id: string;
    label: string;
    golden?: boolean;
    createdAt?: number;
};

/** A row as the listing shows it. `_id` is kept for a caller that acts on the
 *  row; it is never PRINTED — the label is the handle a human types. */
export type ScenarioListingRow = {
    _id: string;
    label: string;
    golden: boolean;
};

/**
 * Pure listing projection. Sorts by label so two runs against an unchanged
 * deployment print identical output — a listing whose order comes from the
 * table's scan order is one nobody can diff.
 */
export function projectScenarioListing(
    rows: readonly StoredScenarioRow[]
): ScenarioListingRow[] {
    return rows
        .map((row) => ({
            _id: row._id,
            label: row.label,
            golden: row.golden === true,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * How `scenario:rm` resolves a label to ids (issue #7702): through the
 * `by_label` index (`debugScenarios:debugScenarioIdsByLabel`), ids only —
 * NEVER the full-table `listDebugScenarios`, whose scan of up to 500 full
 * specs exceeds the 1 s query limit under machine load and broke the escape
 * hatch exactly when sessions were busy (load ~40–70). Null for a blank label:
 * nothing to look up.
 *
 * Every row carrying the label comes back, not the first: labels are not
 * unique by schema (a row inserted before upsert-by-label existed can share
 * one), and deleting one of two is a silent half-success. The label is
 * trimmed, as every write path trims it.
 */
export function scenarioIdLookup(
    label: string
): { fn: string; payload: { label: string } } | null {
    const wanted = label.trim();
    if (wanted === "") return null;
    return {
        fn: "debugScenarios:debugScenarioIdsByLabel",
        payload: { label: wanted },
    };
}

/** The line `scenario:ls` prints for one row. `★` marks a golden scenario, the
 *  same glyph the admin panel uses for the flag; the leading space keeps the
 *  label column aligned across both states. */
export function formatScenarioRow(row: ScenarioListingRow): string {
    return `${row.golden ? "★" : " "} ${row.label}`;
}

/** The verdict line `scenario:rm` prints. A `0` is the interesting outcome —
 *  a typo'd label removed nothing — and it must not read as success. */
export function formatDeleteOutcome(label: string, deleted: number): string {
    if (deleted === 0) {
        return `scenario:rm: no scenario labelled "${label}" — nothing deleted`;
    }
    return `scenario:rm: deleted ${deleted} scenario(s) labelled "${label}"`;
}

/** A `users` row, as `convex data users --format json` prints it. */
export type UserRow = { _id: string; isAdmin?: boolean; email?: string };

/**
 * Pick the identity the CLI impersonates. `assertIsAdmin` gates every function
 * these commands call, so the caller must BE an admin — this returns the first
 * admin row, or null when the deployment has none.
 *
 * Null is a real, nameable state (a fresh deployment nobody has flagged yet)
 * and the caller reports it as such: a bare `Forbidden: admin only` is exactly
 * the unhelpful error that sent issue #3331 down the wrong path.
 */
export function selectAdminIdentity(rows: readonly UserRow[]): string | null {
    return rows.find((row) => row.isAdmin === true)?._id ?? null;
}

/**
 * The `--identity` payload for a user id. `auth.getUserId` (convex-auth) reads
 * `subject` and splits on `|`, so the suffix after the bar is free — it is
 * there to make a CLI-issued identity legible in a log, not to authenticate
 * anything. `issuer`/`tokenIdentifier` mirror what the local provider emits.
 */
export function identityPayload(userId: string): string {
    return JSON.stringify({
        subject: `${userId}|cli`,
        issuer: "https://local",
        tokenIdentifier: `local|${userId}`,
    });
}
