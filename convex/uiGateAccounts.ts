// The `check:ui` lane's throwaway accounts (issue #3626, PRD #3625 slice A).
//
// WHY THIS EXISTS. Every lane run used to sign in as ONE shared dev account on
// the one local deployment, and much of what the walks depend on is bound to
// the account: the lobby allows one game at a time, the deck builder autosaves
// a real deck, the Limited fixtures were upserted under fixed labels. Two
// sessions running the lane at once turned each other's game surfaces
// UNWALKED, and a game some other session left open blocked a run with zero
// FAIL rows (PR #3623). So each run now owns its account:
//
//   1. the lane registers `ui-gate+<runId>@ui-gate.invalid` through the real
//      Password sign-up flow (no auth shortcut lives here);
//   2. `grantLaneRoles` makes it admin + tester, the roles the admin-gated and
//      debug-sheet walks need;
//   3. `limitedFixtures:seedUiGateFixtures` seeds its Limited fixtures under
//      run-scoped labels;
//   4. at the end of the run — success, failure, SIGINT, SIGTERM —
//      `destroyLaneAccount` removes the account and every row it owns;
//   5. every bootstrap first runs `sweepStaleLaneAccounts`, which collects the
//      accounts of runs killed with no chance to clean up.
//
// SAFETY. Every function here is INTERNAL, reachable only with deploy access
// (`bunx convex run`), never from a client — but internal functions deploy to
// EVERY deployment, so each one also guards itself: the address (or the user
// id it resolves to) must match the lane pattern (`lib/uiGateLaneAccount.ts`),
// and every function that writes, or that pages another table, refuses a
// deployment that is not local (`CONVEX_CLOUD_URL`). No shared or real
// account can be promoted, paged or destroyed through this module, by a typo
// or by calling a helper directly, and the lane's bootstrap can never mint an
// admin on a real deployment.
//
// SHAPE OF THE TEARDOWN. `games` and `matches` have no per-player index (a
// seat handle is an array element, and solo seats are `${userId}-p1/p2`), so
// finding the account's games is a scan. One mutation scanning a table that
// grows with every abandoned game could outrun a transaction's read limits, so
// the teardown is an ACTION: paginated queries collect the owned ids, small
// mutations delete them (each re-checking ownership), and one last mutation
// deletes everything reachable by an index on the user id, ending with the
// user row itself.
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
    internalAction,
    internalMutation,
    internalQuery,
    type ActionCtx,
    type MutationCtx,
    type QueryCtx,
} from "./_generated/server";
import { seatBelongsToUser } from "./gameLifecycle";
import { deleteSeats } from "./limitedSeatStore";
import {
    isLaneAccountEmail,
    isLocalDeploymentUrl,
    LANE_ACCOUNT_MAX_AGE_MS,
    LANE_EMAIL_RANGE,
} from "./lib/uiGateLaneAccount";
import { deleteGameCascade, deleteMatchCascade } from "./matches";

/** Rows per scan page. `games`/`matches` rows are slim since their decklists
 *  moved to companion tables (issue #2506), so a page stays far inside a
 *  query's read limits. */
const SCAN_PAGE_SIZE = 200;
/** Owned rows deleted per mutation. A Match cascade reads and deletes each of
 *  its Games' companion rows, so this stays small. */
const DELETE_BATCH_SIZE = 16;
/** Lane accounts inspected per sweep. Only runs killed without teardown ever
 *  reach it, plus the handful live right now. */
const SWEEP_SCAN_LIMIT = 200;
/** Scan passes over the id-less tables before the indexed delete. The first
 *  pass finds everything a quiet account owns; later ones exist only for rows
 *  written while the teardown was running. */
const MAX_SCAN_PASSES = 3;

function assertLaneEmail(email: string, action: string): void {
    if (!isLaneAccountEmail(email)) {
        throw new Error(
            `refusing to ${action} "${email}": not a check:ui lane account (ui-gate+<runId>@ui-gate.invalid)`
        );
    }
}

function assertLocalDeployment(action: string): void {
    const url = process.env.CONVEX_CLOUD_URL;
    if (!isLocalDeploymentUrl(url)) {
        throw new Error(
            `refusing to ${action} on ${url ?? "an unidentified deployment"}: check:ui lane accounts exist only on a local deployment`
        );
    }
}

async function laneUserByEmail(
    ctx: QueryCtx,
    email: string
): Promise<Doc<"users"> | null> {
    return await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .unique();
}

/** The user-id twin of `assertLaneEmail`, for the page/delete helpers the
 *  action hands a resolved id to. The user row still exists whenever they run
 *  (it is deleted last), so a missing row is refused too. */
async function assertLaneUserId(
    ctx: QueryCtx,
    userId: Id<"users">
): Promise<void> {
    const user = await ctx.db.get(userId);
    if (!user || !isLaneAccountEmail(user.email)) {
        throw new Error(
            `refusing to touch rows owned by ${userId}: not a check:ui lane account`
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Role grant
// ─────────────────────────────────────────────────────────────────────────────

export const grantLaneRoles = internalMutation({
    args: { email: v.string() },
    returns: v.id("users"),
    handler: async (ctx, args) => {
        assertLaneEmail(args.email, "grant admin and tester to");
        assertLocalDeployment("grant admin and tester");
        const user = await laneUserByEmail(ctx, args.email);
        if (!user) {
            throw new Error(
                `no user "${args.email}" on this deployment — the lane registers it before granting roles`
            );
        }
        await ctx.db.patch(user._id, { isAdmin: true, isTester: true });
        return user._id;
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// Teardown
// ─────────────────────────────────────────────────────────────────────────────

/** The tables whose rows reference the account only through a field no index
 *  covers, so the teardown pages through them. */
const scanTableValidator = v.union(
    v.literal("matches"),
    v.literal("games"),
    v.literal("verdicts"),
    v.literal("bugReports")
);
type ScanTable = typeof scanTableValidator.type;
const SCAN_TABLES: readonly ScanTable[] = [
    // Matches first: their cascade takes their Games with them, so the Game
    // pass only has match-less or already-gone ids left to act on.
    "matches",
    "games",
    "verdicts",
    "bugReports",
];

/** Does this row belong to the account? Games and Matches by any seat handle
 *  (`seatBelongsToUser` — the one authority on solo `-p1`/`-p2` handles). */
function rowBelongsToUser(
    table: ScanTable,
    doc: Doc<ScanTable>,
    userId: Id<"users">
): boolean {
    switch (table) {
        case "matches":
        case "games":
            return (doc as Doc<"games"> | Doc<"matches">).players.some((p) =>
                seatBelongsToUser(p.id, userId)
            );
        case "verdicts":
            return (doc as Doc<"verdicts">).authorId === userId;
        case "bugReports":
            return (doc as Doc<"bugReports">).userId === userId;
    }
}

export const laneUserIdByEmail = internalQuery({
    args: { email: v.string() },
    returns: v.union(v.id("users"), v.null()),
    handler: async (ctx, args) => {
        return (await laneUserByEmail(ctx, args.email))?._id ?? null;
    },
});

export const ownedRowsPage = internalQuery({
    args: {
        table: scanTableValidator,
        userId: v.id("users"),
        cursor: v.union(v.string(), v.null()),
    },
    returns: v.object({
        ids: v.array(v.string()),
        continueCursor: v.string(),
        isDone: v.boolean(),
    }),
    handler: async (ctx, args) => {
        assertLocalDeployment("page a lane account's rows");
        await assertLaneUserId(ctx, args.userId);
        const result = await ctx.db
            .query(args.table)
            .paginate({ numItems: SCAN_PAGE_SIZE, cursor: args.cursor });
        const ids = (result.page as Doc<ScanTable>[])
            .filter((doc) => rowBelongsToUser(args.table, doc, args.userId))
            .map((doc) => doc._id as string);
        return {
            ids,
            continueCursor: result.continueCursor,
            isDone: result.isDone,
        };
    },
});

export const deleteOwnedRows = internalMutation({
    args: {
        table: scanTableValidator,
        userId: v.id("users"),
        ids: v.array(v.string()),
    },
    returns: v.number(),
    handler: async (ctx, args) => {
        assertLocalDeployment("delete a lane account's rows");
        await assertLaneUserId(ctx, args.userId);
        let deleted = 0;
        for (const raw of args.ids) {
            const id = ctx.db.normalizeId(args.table, raw);
            // Gone already: a Game its Match's cascade took, or a second
            // teardown of the same account.
            if (!id) continue;
            const doc = (await ctx.db.get(id)) as Doc<ScanTable> | null;
            if (!doc) continue;
            // Re-checked here, not trusted from the page: this mutation must
            // be unable to delete a row the account does not own, whoever
            // calls it with whatever ids.
            if (!rowBelongsToUser(args.table, doc, args.userId)) continue;
            if (args.table === "matches") {
                await deleteMatchCascade(ctx, id as Id<"matches">);
            } else if (args.table === "games") {
                await deleteGameCascade(ctx, id as Id<"games">);
            } else {
                const attachmentId =
                    args.table === "bugReports"
                        ? (doc as Doc<"bugReports">).attachmentId
                        : undefined;
                // The blob is not a row: deleting the report alone strands it.
                if (attachmentId) await ctx.storage.delete(attachmentId);
                await ctx.db.delete(id);
            }
            deleted++;
        }
        return deleted;
    },
});

/** Everything reachable from the user id by an index, then the user row. */
async function deleteIndexedAccountRows(
    ctx: MutationCtx,
    user: Doc<"users">
): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    const bump = (table: string, n = 1) => {
        counts[table] = (counts[table] ?? 0) + n;
    };

    for (const deck of await ctx.db
        .query("userDecks")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect()) {
        await ctx.db.delete(deck._id);
        bump("userDecks");
    }

    for (const event of await ctx.db
        .query("limitedEvents")
        .withIndex("by_createdBy", (q) => q.eq("createdBy", user._id))
        .collect()) {
        // Seats + selections, then the frozen cube pool, then the event.
        await deleteSeats(ctx, event._id);
        for (const pool of await ctx.db
            .query("limitedCubePools")
            .withIndex("by_event", (q) => q.eq("eventId", event._id))
            .collect()) {
            await ctx.db.delete(pool._id);
        }
        await ctx.db.delete(event._id);
        bump("limitedEvents");
    }

    for (const settings of await ctx.db
        .query("userSettings")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect()) {
        await ctx.db.delete(settings._id);
        bump("userSettings");
    }

    for (const scenario of await ctx.db
        .query("debugScenarios")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect()) {
        await ctx.db.delete(scenario._id);
        bump("debugScenarios");
    }

    for (const account of await ctx.db
        .query("authAccounts")
        .withIndex("userIdAndProvider", (q) => q.eq("userId", user._id))
        .collect()) {
        for (const code of await ctx.db
            .query("authVerificationCodes")
            .withIndex("accountId", (q) => q.eq("accountId", account._id))
            .collect()) {
            await ctx.db.delete(code._id);
            bump("authVerificationCodes");
        }
        await ctx.db.delete(account._id);
        bump("authAccounts");
    }

    for (const session of await ctx.db
        .query("authSessions")
        .withIndex("userId", (q) => q.eq("userId", user._id))
        .collect()) {
        for (const token of await ctx.db
            .query("authRefreshTokens")
            .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
            .collect()) {
            await ctx.db.delete(token._id);
            bump("authRefreshTokens");
        }
        await ctx.db.delete(session._id);
        bump("authSessions");
    }

    // Failed sign-in counters are keyed by the address, not by an id.
    if (user.email) {
        for (const limit of await ctx.db
            .query("authRateLimits")
            .withIndex("identifier", (q) => q.eq("identifier", user.email!))
            .collect()) {
            await ctx.db.delete(limit._id);
            bump("authRateLimits");
        }
    }

    await ctx.db.delete(user._id);
    bump("users");
    return counts;
}

export const deleteLaneAccountRows = internalMutation({
    args: { email: v.string() },
    returns: v.record(v.string(), v.number()),
    handler: async (ctx, args) => {
        assertLaneEmail(args.email, "destroy");
        assertLocalDeployment("destroy a lane account");
        const user = await laneUserByEmail(ctx, args.email);
        if (!user) return {};
        return await deleteIndexedAccountRows(ctx, user);
    },
});

const teardownResultValidator = v.object({
    destroyed: v.boolean(),
    counts: v.record(v.string(), v.number()),
});
type TeardownResult = typeof teardownResultValidator.type;

type OwnedRowsPage = { ids: string[]; continueCursor: string; isDone: boolean };

/**
 * This module's own functions, referenced BY NAME rather than through
 * `internal.uiGateAccounts.*`. `convex/_generated` is gitignored and copied
 * from the primary checkout when a worktree is bootstrapped, so until the
 * primary next runs codegen, `internal` has no `uiGateAccounts` key — and
 * every worktree cut in that window would fail `check:ts` on this file for a
 * reason none of its diff caused.
 */
const refs = {
    laneUserIdByEmail: makeFunctionReference<
        "query",
        { email: string },
        Id<"users"> | null
    >("uiGateAccounts:laneUserIdByEmail"),
    ownedRowsPage: makeFunctionReference<
        "query",
        { table: ScanTable; userId: Id<"users">; cursor: string | null },
        OwnedRowsPage
    >("uiGateAccounts:ownedRowsPage"),
    deleteOwnedRows: makeFunctionReference<
        "mutation",
        { table: ScanTable; userId: Id<"users">; ids: string[] },
        number
    >("uiGateAccounts:deleteOwnedRows"),
    deleteLaneAccountRows: makeFunctionReference<
        "mutation",
        { email: string },
        Record<string, number>
    >("uiGateAccounts:deleteLaneAccountRows"),
    staleLaneAccountEmails: makeFunctionReference<
        "query",
        { createdBefore: number },
        string[]
    >("uiGateAccounts:staleLaneAccountEmails"),
};

async function destroyLaneAccountVia(
    ctx: ActionCtx,
    email: string
): Promise<TeardownResult> {
    assertLaneEmail(email, "destroy");
    assertLocalDeployment("destroy a lane account");
    const userId = await ctx.runQuery(refs.laneUserIdByEmail, { email });
    if (!userId) return { destroyed: false, counts: {} };

    const counts: Record<string, number> = {};
    // Repeated until a pass deletes nothing: a page still open when the run
    // was signalled can write a game or a deck autosave after its table was
    // scanned, and that row must not outlive the user it points at. Bounded,
    // because a client that keeps writing forever is not something a teardown
    // can out-wait — the sweep is the backstop.
    for (let pass = 0; pass < MAX_SCAN_PASSES; pass++) {
        let deletedThisPass = 0;
        for (const table of SCAN_TABLES) {
            const owned: string[] = [];
            let cursor: string | null = null;
            for (;;) {
                const page: OwnedRowsPage = await ctx.runQuery(
                    refs.ownedRowsPage,
                    { table, userId, cursor }
                );
                owned.push(...page.ids);
                if (page.isDone) break;
                cursor = page.continueCursor;
            }
            for (let i = 0; i < owned.length; i += DELETE_BATCH_SIZE) {
                const deleted = await ctx.runMutation(refs.deleteOwnedRows, {
                    table,
                    userId,
                    ids: owned.slice(i, i + DELETE_BATCH_SIZE),
                });
                if (deleted > 0) {
                    counts[table] = (counts[table] ?? 0) + deleted;
                    deletedThisPass += deleted;
                }
            }
        }
        if (deletedThisPass === 0) break;
    }

    const indexed = await ctx.runMutation(refs.deleteLaneAccountRows, {
        email,
    });
    for (const [table, n] of Object.entries(indexed)) {
        counts[table] = (counts[table] ?? 0) + n;
    }
    return { destroyed: true, counts };
}

export const destroyLaneAccount = internalAction({
    args: { email: v.string() },
    returns: teardownResultValidator,
    handler: async (ctx, args) => await destroyLaneAccountVia(ctx, args.email),
});

// ─────────────────────────────────────────────────────────────────────────────
// Sweep
// ─────────────────────────────────────────────────────────────────────────────

export const staleLaneAccountEmails = internalQuery({
    args: { createdBefore: v.number() },
    returns: v.array(v.string()),
    handler: async (ctx, args) => {
        const candidates = await ctx.db
            .query("users")
            .withIndex("email", (q) =>
                q
                    .gte("email", LANE_EMAIL_RANGE.gte)
                    .lt("email", LANE_EMAIL_RANGE.lt)
            )
            .take(SWEEP_SCAN_LIMIT);
        // The range is a read bound; the pattern is the authority.
        return candidates
            .filter(
                (u) =>
                    isLaneAccountEmail(u.email) &&
                    u._creationTime < args.createdBefore
            )
            .map((u) => u.email as string);
    },
});

export const sweepStaleLaneAccounts = internalAction({
    args: {},
    returns: v.object({ swept: v.array(v.string()) }),
    handler: async (ctx) => {
        assertLocalDeployment("sweep lane accounts");
        const stale = await ctx.runQuery(refs.staleLaneAccountEmails, {
            createdBefore: Date.now() - LANE_ACCOUNT_MAX_AGE_MS,
        });
        for (const email of stale) await destroyLaneAccountVia(ctx, email);
        return { swept: stale };
    },
});
