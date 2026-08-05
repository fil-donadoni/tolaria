import { ConvexError, v } from "convex/values";
import {
    action,
    internalMutation,
    internalQuery,
    mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getCurrentUserId } from "./auth";
import { expandState } from "./gre/serialize";

// Bug-report intake. A floating in-app button (all routes) opens a dialog that
// collects a reporter name/email, a free-text description and an optional file,
// then files a GitHub issue on the tracker repo. The GitHub PAT is a secret and
// MUST NOT reach the client, so issue creation runs in a Convex `action`
// (network-capable) reading the token from `GITHUB_TOKEN` env. The optional
// attachment is uploaded to Convex storage first (client → `generateUploadUrl`)
// and embedded in the issue body as a link — the GitHub REST API cannot attach
// binary files to an issue directly.
//
// Every report is ALSO persisted to the `bugReports` table, and the split
// between that row and the issue is one line: **the tracker repo is public.**
//
// - The ROW holds the evidence: the reporter's email (the only way to ask a
//   follow-up question), the full game state, and the attachment.
// - The ISSUE holds the work item: the description, the non-sensitive board
//   context (turn / phase / who has priority / what input is owed) and the
//   row's id.
//
// A report filed FROM a game captures that game's state (issue #1728). Most
// in-app reports are about something happening on the board right now, and the
// free-text description is almost never enough to act on: #1728 was "Oppo
// continua a pensare e non si sblocca" and nothing else — no card, no phase, no
// game id — which is exactly the information the state row already held. The
// snapshot is read SERVER-SIDE from `gameStates` (the client passes only a
// `gameId`, and only a participant of that game can read it), so a report can
// neither forge a state nor harvest someone else's.

const REPO = "fil-donadoni/tolaria";
const TRIAGE_LABEL = "needs-triage";
const DESCRIPTION_MAX = 8000;

export type IssueInput = {
    name: string;
    description: string;
    route?: string;
    userAgent?: string;
    attachmentName?: string;
    gameSection?: string | null;
    /** `bugReports` row id, printed in the issue so a maintainer can pull the
     *  evidence the issue deliberately does not carry. */
    reportId?: string;
};

/** The `gameStates` row for a report, already expanded to a real `GameState`.
 *  The compact on-disk form encodes cards as indices into a per-row pool, which
 *  is unreadable without running `expandState` — the point of attaching it is
 *  that a human or an agent can read it straight out of the issue. */
export type GameSnapshot = {
    gameId: string;
    seq: number;
    state: Record<string, unknown>;
};

/**
 * Names the containers that are holding the game up, derived from the state's
 * own keys rather than from a hand-written list. Every "the game is waiting on
 * someone" container in `GameState` is named `pending*` (`pendingCast`,
 * `pendingActivation`, `pendingChoices`, `pendingTarget`,
 * `pendingCompanionPay`, …), so a census over the keys stays correct when a new
 * one is added — a hand-maintained list is precisely how #1209's park family
 * grew uncovered one member at a time.
 */
export function describeOwedInput(state: Record<string, unknown>): string[] {
    const owed: string[] = [];
    for (const key of Object.keys(state).sort()) {
        if (!key.startsWith("pending")) continue;
        const value = state[key];
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
            if (value.length > 0) owed.push(`${key}[${value.length}]`);
            continue;
        }
        owed.push(key);
    }
    return owed;
}

/**
 * Pure renderer for the board-context lines of the issue body.
 *
 * Deliberately a SUMMARY and not the state itself. Turn, phase, whose priority
 * it is and which container is owed input are public facts about a position —
 * they are what makes a one-sentence report triageable, and they say nothing
 * about either player's hidden zones. The state that answers "and then what
 * happened" lives on the `bugReports` row, off the public tracker.
 */
export function buildGameStateSection(snapshot: GameSnapshot): string {
    const { state } = snapshot;
    const facts = [
        `\`${snapshot.gameId}\``,
        `seq ${snapshot.seq}`,
        `turn ${String(state.turn ?? "?")}`,
        String(state.phase ?? "?"),
        `active: ${String(state.activePlayerId ?? "?")}`,
        `priority: ${String(state.priorityPlayerId ?? "?")}`,
    ];
    const lines = [`**Game:** ${facts.join(" · ")}`];

    const owed = describeOwedInput(state);
    if (owed.length > 0) lines.push(`**Owed input:** ${owed.join(", ")}`);

    return lines.join("\n");
}

/**
 * Pure GitHub-issue payload builder — kept free of Convex/network so it can be
 * unit-tested directly (the project has no convex-test harness). Derives the
 * title from the first line of the description and appends a reporter/context
 * footer. Throws `ConvexError` on an empty/oversized description — a plain
 * `Error` message is stripped by Convex in production and reaches the client as
 * a bare "Server Error".
 *
 * This function is where the public/private line is DRAWN, so it takes no
 * email, no state and no attachment URL: a field that never reaches the builder
 * cannot be leaked by a later edit to the template. What it emits instead is
 * the report id, which is how a maintainer reaches all three.
 */
export function buildIssuePayload(input: IssueInput): {
    title: string;
    body: string;
} {
    const description = input.description.trim();
    if (!description) throw new ConvexError("Description is required");
    if (description.length > DESCRIPTION_MAX) {
        throw new ConvexError(
            `Description too long (max ${DESCRIPTION_MAX} characters)`
        );
    }

    const name = input.name.trim() || "Anonymous";

    // First line of the description seeds the issue title (trimmed to a sane
    // length); fall back to a generic title for an empty first line.
    const firstLine = description.split("\n")[0]!.trim();
    const title = firstLine
        ? `[Bug] ${firstLine.slice(0, 120)}`
        : "[Bug] In-app report";

    const bodyLines = [description, "", "---", `**Reporter:** ${name}`];
    if (input.route) bodyLines.push(`**Route:** \`${input.route}\``);
    if (input.userAgent) {
        bodyLines.push(`**User agent:** ${input.userAgent}`);
    }
    // The file itself stays on the report row: a screenshot of a board shows a
    // hand. Name it so a maintainer knows there is one to fetch.
    if (input.attachmentName) {
        bodyLines.push(`**Attachment:** \`${input.attachmentName}\``);
    }
    if (input.gameSection) bodyLines.push("", input.gameSection);
    if (input.reportId) {
        bodyLines.push(
            "",
            `**Report:** \`${input.reportId}\` — email, attachment and full game state are on the report row, not here (public repo). Read it with:`,
            "",
            "```",
            `bunx convex run bugReports:getReport '{"reportId":"${input.reportId}"}' --prod`,
            "```"
        );
    }
    bodyLines.push("", "_Filed from the in-app bug-report button._");

    return { title, body: bodyLines.join("\n") };
}

/**
 * Short-lived, auth-gated upload URL for the optional attachment. The client
 * POSTs the file to the returned URL and gets back a `storageId` to pass into
 * `submitBugReport`. Gated so only logged-in users can push blobs to storage.
 */
export const generateUploadUrl = mutation({
    args: {},
    returns: v.string(),
    handler: async (ctx) => {
        await getCurrentUserId(ctx);
        return await ctx.storage.generateUploadUrl();
    },
});

/**
 * Whether `userId` is one of the seats of a game. `players[].id` is an opaque
 * handle: it EQUALS the user id in a 2-player game, but a solo game seats the
 * same user twice as `${userId}-p1` / `${userId}-p2`, so an equality-only check
 * would silently attach nothing to every solo report — the majority of them.
 * Pure and exported so the rule is testable without a Convex harness.
 */
export function isGameParticipant(
    players: readonly { id: string }[],
    userId: string
): boolean {
    return players.some(
        (p) => p.id === userId || p.id.startsWith(`${userId}-`)
    );
}

/**
 * Reads a game's current state for a bug report. `internalQuery`, so the only
 * caller is `submitBugReport` — but it still authorises independently: an
 * action propagates the caller's identity into `ctx.runQuery`, and this query
 * is the one place that decides whether the caller may read this game. The
 * client supplies a `gameId` it cannot be trusted with; without this check
 * anyone could pull an arbitrary game's state into a report of their own — and
 * publish its board context to the public tracker — by filing against its id.
 * The state no longer reaches the issue body, which narrows the blast radius
 * but does not remove it: the check is the thing that makes `gameId` safe to
 * accept from a client at all.
 *
 * Returns `null` — never throws — for a missing game, a non-participant or a
 * game with no state row yet (waiting/pregame). A bug report must still be
 * filed when the state cannot be attached; losing the report over its optional
 * attachment is the worse failure.
 */
export const getGameSnapshotForReport = internalQuery({
    args: { gameId: v.id("games") },
    returns: v.union(
        v.null(),
        v.object({
            gameId: v.string(),
            seq: v.number(),
            state: v.any(),
        })
    ),
    handler: async (ctx, args) => {
        const userId = await getCurrentUserId(ctx);
        const game = await ctx.db.get(args.gameId);
        if (!game) return null;
        if (!isGameParticipant(game.players, userId)) return null;

        const row = await ctx.db
            .query("gameStates")
            .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
            .order("desc")
            .first();
        if (!row) return null;

        return {
            gameId: args.gameId,
            seq: row.seq,
            // Stored compact (cards are indices into a per-row pool); expand so
            // the JSON in the issue is readable as-is.
            state: expandState(
                row.state as Record<string, unknown>
            ) as unknown as Record<string, unknown>,
        };
    },
});

/**
 * Persists the report BEFORE the issue is filed. Order is deliberate: the row
 * is the report, the issue is a view of it, and a GitHub outage (or a revoked
 * token) must cost us the issue and never the user's words. It also means the
 * row id exists in time to be printed in the issue body.
 *
 * `userId` comes from the caller's identity, not from the client-supplied
 * name/email — those are display values a reporter may edit freely in the
 * dialog, so they identify a person to contact, not an account.
 */
export const createReportRow = internalMutation({
    args: {
        name: v.string(),
        email: v.string(),
        description: v.string(),
        route: v.optional(v.string()),
        userAgent: v.optional(v.string()),
        attachmentId: v.optional(v.id("_storage")),
        attachmentName: v.optional(v.string()),
        gameId: v.optional(v.id("games")),
        seq: v.optional(v.number()),
        state: v.optional(v.any()),
    },
    returns: v.id("bugReports"),
    handler: async (ctx, args) => {
        const userId = await getCurrentUserId(ctx);
        return await ctx.db.insert("bugReports", { ...args, userId });
    },
});

/** Back-links the filed issue onto its report row. Separate from the insert
 *  because the issue number only exists after the POST returns. */
export const attachIssueRef = internalMutation({
    args: {
        reportId: v.id("bugReports"),
        issueNumber: v.optional(v.number()),
        issueUrl: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const { reportId, ...ref } = args;
        await ctx.db.patch(reportId, ref);
        return null;
    },
});

/**
 * Reads back everything the issue deliberately withholds — email, attachment,
 * full game state. `internalQuery`, so it is reachable only from the server or
 * from an operator holding the deployment's admin key
 * (`bunx convex run bugReports:getReport … --prod`), never from a client.
 *
 * The attachment is returned as a freshly-resolved storage URL rather than a
 * stored one: the stored form is an id, and minting the link at read time
 * keeps the only public-ish URL out of the DB as well as out of the issue.
 */
export const getReport = internalQuery({
    args: { reportId: v.id("bugReports") },
    returns: v.union(
        v.null(),
        v.object({
            name: v.string(),
            email: v.string(),
            description: v.string(),
            route: v.optional(v.string()),
            userAgent: v.optional(v.string()),
            attachmentName: v.optional(v.string()),
            attachmentUrl: v.union(v.string(), v.null()),
            gameId: v.optional(v.id("games")),
            seq: v.optional(v.number()),
            state: v.optional(v.any()),
            issueNumber: v.optional(v.number()),
            issueUrl: v.optional(v.string()),
            filedAt: v.number(),
        })
    ),
    handler: async (ctx, args) => {
        const row = await ctx.db.get(args.reportId);
        if (!row) return null;
        return {
            name: row.name,
            email: row.email,
            description: row.description,
            route: row.route,
            userAgent: row.userAgent,
            attachmentName: row.attachmentName,
            attachmentUrl: row.attachmentId
                ? await ctx.storage.getUrl(row.attachmentId)
                : null,
            gameId: row.gameId,
            seq: row.seq,
            state: row.state,
            issueNumber: row.issueNumber,
            issueUrl: row.issueUrl,
            filedAt: row._creationTime,
        };
    },
});

/**
 * Files a GitHub issue from a bug report. Runs as an action because it performs
 * a network `fetch` to the GitHub REST API — mutations cannot. Returns the
 * created issue URL on success; throws with a readable message on failure so
 * the dialog can surface it.
 */
export const submitBugReport = action({
    args: {
        name: v.string(),
        email: v.string(),
        description: v.string(),
        // storageId of an already-uploaded attachment, if any.
        attachmentId: v.optional(v.id("_storage")),
        attachmentName: v.optional(v.string()),
        // Client-captured context to aid triage (current route + browser).
        route: v.optional(v.string()),
        userAgent: v.optional(v.string()),
        // The game the reporter is sitting in, if any. Only an id — the state
        // itself is read server-side and only for a participant.
        gameId: v.optional(v.id("games")),
    },
    returns: v.object({ issueUrl: v.string() }),
    handler: async (ctx, args): Promise<{ issueUrl: string }> => {
        // Auth-gate: only logged-in users may file issues.
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new ConvexError("Not authenticated");

        const token = process.env.GITHUB_TOKEN;
        if (!token) {
            throw new ConvexError(
                "Bug reporting is not configured (missing GITHUB_TOKEN)"
            );
        }

        // The snapshot is best-effort: a report filed from the lobby has no
        // gameId, and a game that has not started has no state row. Neither is
        // a reason to fail the report.
        const snapshot = args.gameId
            ? await ctx.runQuery(internal.bugReports.getGameSnapshotForReport, {
                  gameId: args.gameId,
              })
            : null;

        const reportId: Id<"bugReports"> = await ctx.runMutation(
            internal.bugReports.createReportRow,
            {
                name: args.name,
                email: args.email,
                description: args.description,
                route: args.route,
                userAgent: args.userAgent,
                attachmentId: args.attachmentId,
                attachmentName: args.attachmentName,
                gameId: args.gameId,
                seq: snapshot?.seq,
                state: snapshot?.state,
            }
        );

        const { title, body } = buildIssuePayload({
            name: args.name,
            description: args.description,
            route: args.route,
            userAgent: args.userAgent,
            attachmentName: args.attachmentName,
            gameSection: snapshot ? buildGameStateSection(snapshot) : null,
            reportId,
        });

        const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
                "Content-Type": "application/json",
                "User-Agent": "tolaria-bug-report",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            body: JSON.stringify({ title, body, labels: [TRIAGE_LABEL] }),
        });

        if (!res.ok) {
            const detail = await res.text().catch(() => "");
            throw new ConvexError(
                `GitHub API error (${res.status}): ${detail.slice(0, 300)}`
            );
        }

        const issue = (await res.json()) as {
            html_url?: string;
            number?: number;
        };
        if (!issue.html_url) {
            throw new ConvexError("GitHub API returned no issue URL");
        }
        await ctx.runMutation(internal.bugReports.attachIssueRef, {
            reportId,
            issueNumber: issue.number,
            issueUrl: issue.html_url,
        });
        return { issueUrl: issue.html_url };
    },
});
