import { ConvexError, v } from "convex/values";
import {
    action,
    internalAction,
    internalMutation,
    internalQuery,
    mutation,
    query,
    type MutationCtx,
    type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { getCurrentUserId, assertIsAdmin } from "./auth";
import { getLatestGameState } from "./gameStateStore";
import {
    describeOwedInput,
    summarizeGameSnapshot,
    type GameSnapshot,
} from "./bugReportSummary";
import {
    REPORT_RATE_LIMITED_CODE,
    REPORT_WINDOW_MS,
    reportRetryAt,
    type ReportRateLimitedData,
} from "./bugReportRateLimit";
import {
    BUG_REPORT_CONSENT_VERSION,
    type BugReportDiagnostics,
} from "./bugReportConsent";
import {
    SYSTEM_REPORTER_NAME,
    SYSTEM_REPORT_WINDOW_MS,
    botFaultFingerprint,
    botFaultHeadline,
    botFaultValidator,
    buildBotFaultIssueRequest,
    buildBotFaultOccurrenceComment,
    planSystemReportFiling,
    systemReportCapReason,
    type BotFault,
} from "./botFaultReport";

// Re-exported so existing importers (`convex/__tests__/bugReports.test.ts`)
// keep working unchanged — the derivation itself now lives in
// `bugReportSummary.ts` because it must also be importable from the client
// (see that module's header comment).
export { describeOwedInput };
export type { GameSnapshot };

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
/**
 * `user-report` — provenance, a fact that never changes; `needs-triage` —
 * state, the owner has not read it yet (`queue:plan` never picks it while it
 * stands). Both stamped on every filed issue: without `user-report`, ADR
 * 0143's `labels` default never sees a player's report as anything stronger
 * than `bug`/`enhancement`, so it lands in the residue instead of the
 * critical (`P1`) track (issue #4409). GitHub's create-issue endpoint
 * auto-creates a label from this list if the repo doesn't have it yet, so
 * there is no separate label-creation call and no failure mode a missing
 * label could open.
 */
export const REPORT_LABELS = ["user-report", "needs-triage"] as const;
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

/**
 * Pure renderer for the board-context lines of the issue body — formats
 * `summarizeGameSnapshot`'s structured facts as markdown. The admin
 * `/admin/bug-reports` detail view (`BugReportSnapshotHeader`) formats the
 * SAME derivation as UI instead; neither re-derives it.
 *
 * Deliberately a SUMMARY and not the state itself. Turn, phase, whose priority
 * it is and which container is owed input are public facts about a position —
 * they are what makes a one-sentence report triageable, and they say nothing
 * about either player's hidden zones. The state that answers "and then what
 * happened" lives on the `bugReports` row, off the public tracker.
 */
export function buildGameStateSection(snapshot: GameSnapshot): string {
    const summary = summarizeGameSnapshot(snapshot);
    const facts = [
        `\`${summary.gameId}\``,
        `seq ${summary.seq}`,
        `turn ${summary.turn}`,
        summary.phase,
        `active: ${summary.activePlayerId}`,
        `priority: ${summary.priorityPlayerId}`,
    ];
    const lines = [`**Game:** ${facts.join(" · ")}`];

    if (summary.owedInput.length > 0) {
        lines.push(`**Owed input:** ${summary.owedInput.join(", ")}`);
    }

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
        ? `[User Bug] ${firstLine.slice(0, 120)}`
        : "[User Bug] In-app report";

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
 * The full request body `submitBugReport` POSTs to GitHub's create-an-issue
 * endpoint — `buildIssuePayload`'s title/body plus `REPORT_LABELS`. A pure
 * wrapper only so the payload the mutation actually sends is testable
 * without a network call (issue #4409).
 */
export function buildIssueRequest(input: IssueInput): {
    title: string;
    body: string;
    labels: readonly string[];
} {
    return { ...buildIssuePayload(input), labels: REPORT_LABELS };
}

/**
 * The cut the bug-report disclosure licenses (issue #3255), in ONE pure place
 * so it is unit-testable and so the row, the issue body and the game-state read
 * cannot each decide it differently.
 *
 * A decline drops every diagnostic field. The dialog already withholds them,
 * and this re-derives the same cut server-side anyway: a client that sends a
 * payload it was not licensed to send must not have it stored, and the dialog
 * is not the authority on that (ADR 0074).
 */
export function applyDiagnosticsConsent(
    fields: BugReportDiagnostics,
    diagnosticsConsent: boolean
): BugReportDiagnostics {
    if (!diagnosticsConsent) return {};
    return fields;
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

        // Stored compact (cards are indices into a per-row pool); the snapshot
        // comes back expanded so the stored JSON is readable as-is.
        const snapshot = await readGameSnapshot(ctx, args.gameId);
        if (!snapshot) return null;
        return { gameId: args.gameId, ...snapshot };
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
        clientDiagnostics: v.optional(v.any()),
        consentVersion: v.optional(v.number()),
        diagnosticsConsent: v.optional(v.boolean()),
    },
    returns: v.id("bugReports"),
    handler: async (ctx, args) => {
        const userId = await getCurrentUserId(ctx);
        // Rate limit (issue #4076), checked in the SAME transaction as the
        // insert so concurrent submissions cannot both slip under the cap. A
        // refusal throws before the insert: no row, and the action never
        // reaches the GitHub POST.
        const now = Date.now();
        const recent = await ctx.db
            .query("bugReports")
            .withIndex("by_userId", (q) =>
                q
                    .eq("userId", userId)
                    .gt("_creationTime", now - REPORT_WINDOW_MS)
            )
            .collect();
        const retryAt = reportRetryAt(
            recent.map((r) => r._creationTime),
            now
        );
        if (retryAt !== null) {
            const data: ReportRateLimitedData = {
                code: REPORT_RATE_LIMITED_CODE,
                retryAt,
            };
            throw new ConvexError(data);
        }
        const reportId = await ctx.db.insert("bugReports", { ...args, userId });
        // The consent is recorded on the USER at the moment a report is filed
        // under it (issue #3255) — one write, in the same transaction as the
        // row it licensed, rather than a separate public mutation the dialog
        // could forget to call. A DECLINE stores nothing: an account that
        // refused has not consented, so the gate greets it unchecked again.
        if (
            args.diagnosticsConsent === true &&
            args.consentVersion !== undefined
        ) {
            await ctx.db.patch(userId, {
                bugReportConsentAt: Date.now(),
                bugReportConsentVersion: args.consentVersion,
            });
        }
        return reportId;
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
/** The system-channel columns (issue #9000), returned by both detail reads. */
const systemRowFields = {
    source: v.optional(v.union(v.literal("user"), v.literal("system"))),
    fault: v.optional(botFaultValidator),
    fingerprint: v.optional(v.string()),
    filingSkipped: v.optional(v.string()),
};

function systemRowColumns(row: Doc<"bugReports">) {
    return {
        source: row.source,
        fault: row.fault,
        fingerprint: row.fingerprint,
        filingSkipped: row.filingSkipped,
    };
}

export const getReport = internalQuery({
    args: { reportId: v.id("bugReports") },
    returns: v.union(
        v.null(),
        v.object({
            ...systemRowFields,
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
            clientDiagnostics: v.optional(v.any()),
            consentVersion: v.optional(v.number()),
            diagnosticsConsent: v.optional(v.boolean()),
            issueNumber: v.optional(v.number()),
            issueUrl: v.optional(v.string()),
            filedAt: v.number(),
        })
    ),
    handler: async (ctx, args) => {
        const row = await ctx.db.get(args.reportId);
        if (!row) return null;
        return {
            ...systemRowColumns(row),
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
            clientDiagnostics: row.clientDiagnostics,
            // What the reporter had been told when they filed (issue #3255).
            // Absent === filed before the gate shipped; `diagnosticsConsent:
            // false` === they declined and the diagnostic fields above are
            // missing BY CHOICE, not by a bug.
            consentVersion: row.consentVersion,
            diagnosticsConsent: row.diagnosticsConsent,
            issueNumber: row.issueNumber,
            issueUrl: row.issueUrl,
            filedAt: row._creationTime,
        };
    },
});

/**
 * List rows for the `/admin/bug-reports` page (issue #2250). `getReport`
 * above is `internalQuery`-only — an admin UI cannot call it, and its
 * "operator with a deployment admin key + `bunx convex run … --prod`" path is
 * exactly what this page exists to route around. `assertIsAdmin` runs FIRST
 * (ADR 0033) — hiding the route in the UI (`AdminRouteGate`) is cosmetic only.
 *
 * Newest first: `bugReports` has no creation-time index, so plain `.order
 * ("desc")` on the default `_creationTime` order is the newest-first read.
 *
 * Returns a SUMMARY shape, never `state`: a `gameStates` snapshot is 3-9 KB,
 * and Convex has no column projection — `.collect()` deserialises whole
 * documents regardless — so the only way to keep a snapshot off the wire is
 * to never put it on the object this handler returns. The detail query
 * (`getBugReport`) is the only one of the two that reads `state`.
 */
export async function listBugReportsHandler(ctx: QueryCtx) {
    await assertIsAdmin(ctx);
    const rows = await ctx.db.query("bugReports").order("desc").collect();
    return rows.map((row) => ({
        _id: row._id,
        filedAt: row._creationTime,
        isSystem: row.source === "system",
        name: row.name,
        descriptionPreview: row.description.split("\n")[0]!.slice(0, 200),
        issueNumber: row.issueNumber,
        hasSnapshot: row.state !== undefined,
        hasAttachment: row.attachmentId !== undefined,
        hasDiagnostics: row.clientDiagnostics !== undefined,
    }));
}

export const listBugReports = query({
    args: {},
    returns: v.array(
        v.object({
            _id: v.id("bugReports"),
            filedAt: v.number(),
            isSystem: v.boolean(),
            name: v.string(),
            descriptionPreview: v.string(),
            issueNumber: v.optional(v.number()),
            hasSnapshot: v.boolean(),
            hasAttachment: v.boolean(),
            hasDiagnostics: v.boolean(),
        })
    ),
    handler: listBugReportsHandler,
});

/**
 * Detail row for the `/admin/bug-reports` page (issue #2250) — everything
 * `getReport` returns, `assertIsAdmin`-gated instead of internal-only. Same
 * attachment-URL-minted-at-read-time rule as `getReport`: the stored form is
 * an id, never a URL, so the link is always fresh and never persisted.
 */
export async function getBugReportHandler(
    ctx: QueryCtx,
    args: { reportId: Id<"bugReports"> }
) {
    await assertIsAdmin(ctx);
    const row = await ctx.db.get(args.reportId);
    if (!row) return null;
    return {
        ...systemRowColumns(row),
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
        // issue #2470 — the AI rings. This admin query, not the internal
        // `getReport`, is what the `/admin/bug-reports` page renders: a field
        // added only to `getReport` would be readable ONLY through
        // `bunx convex run … --prod`, which is the access path #2250 built this
        // page to route around.
        clientDiagnostics: row.clientDiagnostics,
        // What the reporter had been told when they filed (issue #3255).
        consentVersion: row.consentVersion,
        diagnosticsConsent: row.diagnosticsConsent,
        issueNumber: row.issueNumber,
        issueUrl: row.issueUrl,
        filedAt: row._creationTime,
    };
}

export const getBugReport = query({
    args: { reportId: v.id("bugReports") },
    returns: v.union(
        v.null(),
        v.object({
            ...systemRowFields,
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
            clientDiagnostics: v.optional(v.any()),
            consentVersion: v.optional(v.number()),
            diagnosticsConsent: v.optional(v.boolean()),
            issueNumber: v.optional(v.number()),
            issueUrl: v.optional(v.string()),
            filedAt: v.number(),
        })
    ),
    handler: getBugReportHandler,
});

/** One GitHub REST call on the tracker repo: POST `body` when given, else GET.
 *  `path` is relative to `/repos/<REPO>/`. Shared by both channels so the
 *  auth/version headers are written once. */
function githubFetch(
    token: string,
    path: string,
    body?: unknown
): Promise<Response> {
    return fetch(`https://api.github.com/repos/${REPO}/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "tolaria-bug-report",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

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
        // Client-side AI diagnostics (issue #2470). Unlike the board state,
        // this CANNOT be re-read server-side: the play bot runs in the
        // reporter's own tab (ADR 0074), so the rings only exist there. Stored
        // verbatim and never parsed here — it is evidence for a human, and a
        // report must not fail because a diagnostic field moved on.
        clientDiagnostics: v.optional(v.any()),
        // The disclosure gate's answer (issue #3255). The dialog withholds the
        // diagnostic fields on a decline, and this server re-derives the same
        // cut rather than trusting it to: a client that sends a payload it was
        // not licensed to send must not have it stored.
        diagnosticsConsent: v.boolean(),
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

        // Everything beyond the reporter's words, contact details and the file
        // they chose themselves is diagnostic, and a decline drops all of it —
        // the narrative report still files. The attachment stays either way: a
        // file the reporter picked is a deliberate act, not something collected
        // from under them.
        const diagnostics = applyDiagnosticsConsent(
            {
                route: args.route,
                userAgent: args.userAgent,
                gameId: args.gameId,
                clientDiagnostics: args.clientDiagnostics,
            },
            args.diagnosticsConsent
        );

        // The snapshot is best-effort: a report filed from the lobby has no
        // gameId, and a game that has not started has no state row. Neither is
        // a reason to fail the report. Read through the CUT gameId, so a
        // declined report never even touches the board.
        const snapshot = diagnostics.gameId
            ? await ctx.runQuery(internal.bugReports.getGameSnapshotForReport, {
                  gameId: diagnostics.gameId,
              })
            : null;

        const reportId: Id<"bugReports"> = await ctx.runMutation(
            internal.bugReports.createReportRow,
            {
                name: args.name,
                email: args.email,
                description: args.description,
                route: diagnostics.route,
                userAgent: diagnostics.userAgent,
                attachmentId: args.attachmentId,
                attachmentName: args.attachmentName,
                gameId: diagnostics.gameId,
                seq: snapshot?.seq,
                state: snapshot?.state,
                clientDiagnostics: diagnostics.clientDiagnostics,
                // Stamped on EVERY row, accepted or declined — the version is
                // what the reporter was shown, and a maintainer reading the row
                // later needs to know that as much as the answer.
                consentVersion: BUG_REPORT_CONSENT_VERSION,
                diagnosticsConsent: args.diagnosticsConsent,
            }
        );

        const issueRequest = buildIssueRequest({
            name: args.name,
            description: args.description,
            route: diagnostics.route,
            userAgent: diagnostics.userAgent,
            attachmentName: args.attachmentName,
            gameSection: snapshot ? buildGameStateSection(snapshot) : null,
            reportId,
        });

        const res = await githubFetch(token, "issues", issueRequest);

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

// ── The SYSTEM channel (issue #9000, PRD issue #8998) ──────────────────────
//
// A Bot fault reports itself: the server writes a `source: "system"` row (no
// user, no email) with the frozen state and the fault, and SCHEDULES the
// GitHub filing — the caller (a game mutation that just force-advanced the
// Bot) never waits on GitHub, and a GitHub outage loses the issue, never the
// row. Payload, fingerprint and the dedupe / rate-limit plan are pure, in
// `convex/botFaultReport.ts`.

/** The latest `gameStates` row of a game, expanded — the frozen copy a report
 *  stores. `null` before the game has a state row. No auth: callers decide. */
async function readGameSnapshot(
    ctx: QueryCtx,
    gameId: Id<"games">
): Promise<{ seq: number; state: Record<string, unknown> } | null> {
    const row = await getLatestGameState(ctx, gameId);
    if (!row) return null;
    return {
        seq: row.seq,
        state: row.state as unknown as Record<string, unknown>,
    };
}

export type SystemBugReportInput = {
    gameId: Id<"games">;
    fault: BotFault;
    /** The state AT the fault. A caller that already holds it (the force
     *  advance, before it saves the advanced state) passes it; otherwise the
     *  game's current `gameStates` row is frozen. */
    snapshot?: { seq: number; state: Record<string, unknown> };
    /** The client's Bot telemetry, when a client hand-off carried it. */
    clientDiagnostics?: unknown;
};

/**
 * THE entry point of the system channel, callable inside any mutation: writes
 * the row FIRST, then schedules `fileSystemReportIssue` (`runAfter(0)`), so the
 * filing runs only once this transaction commits and never inside it.
 */
export async function recordSystemBugReport(
    ctx: MutationCtx,
    input: SystemBugReportInput
): Promise<Id<"bugReports">> {
    const snapshot =
        input.snapshot ?? (await readGameSnapshot(ctx, input.gameId));
    const reportId = await ctx.db.insert("bugReports", {
        source: "system",
        name: SYSTEM_REPORTER_NAME,
        email: "",
        description: botFaultHeadline(input.fault),
        gameId: input.gameId,
        seq: snapshot?.seq,
        state: snapshot?.state,
        clientDiagnostics: input.clientDiagnostics,
        fault: input.fault,
        fingerprint: botFaultFingerprint(input.fault),
    });
    await ctx.scheduler.runAfter(0, internal.bugReports.fileSystemReportIssue, {
        reportId,
    });
    return reportId;
}

/** `recordSystemBugReport` as a registered function, for a caller that is not
 *  already inside a mutation (an action, the server deadline's scheduler). */
export const fileSystemReport = internalMutation({
    args: {
        gameId: v.id("games"),
        fault: botFaultValidator,
        clientDiagnostics: v.optional(v.any()),
    },
    returns: v.id("bugReports"),
    handler: (ctx, args) => recordSystemBugReport(ctx, args),
});

/**
 * Everything the filing action needs, read in ONE transaction: the issue and
 * comment bodies (built here, so the state never travels to the action), the
 * two cap counts, and the issue the fingerprint last filed. Counts are of
 * system rows filed BEFORE this one, so a row's cap verdict is fixed.
 */
export const getSystemFilingContext = internalQuery({
    args: { reportId: v.id("bugReports") },
    returns: v.union(
        v.null(),
        v.object({
            request: v.object({
                title: v.string(),
                body: v.string(),
                labels: v.array(v.string()),
            }),
            comment: v.string(),
            priorGameReports: v.number(),
            priorHourReports: v.number(),
            knownIssueNumber: v.optional(v.number()),
        })
    ),
    handler: async (ctx, args) => {
        const row = await ctx.db.get(args.reportId);
        if (!row || row.source !== "system" || !row.fault || !row.fingerprint)
            return null;
        const before = (r: Doc<"bugReports">) =>
            r._id !== row._id && r._creationTime < row._creationTime;

        const gameRows = row.gameId
            ? await ctx.db
                  .query("bugReports")
                  .withIndex("by_gameId", (q) => q.eq("gameId", row.gameId))
                  .take(100)
            : [];
        const hourRows = await ctx.db
            .query("bugReports")
            .withIndex("by_source", (q) =>
                q
                    .eq("source", "system")
                    .gt(
                        "_creationTime",
                        row._creationTime - SYSTEM_REPORT_WINDOW_MS
                    )
            )
            .take(100);
        const sameFingerprint = await ctx.db
            .query("bugReports")
            .withIndex("by_fingerprint", (q) =>
                q.eq("fingerprint", row.fingerprint)
            )
            .order("desc")
            .take(50);
        const known = sameFingerprint.find(
            (r) => before(r) && r.issueNumber !== undefined
        );

        const request = buildBotFaultIssueRequest({
            fault: row.fault,
            fingerprint: row.fingerprint,
            reportId: row._id,
            gameSection:
                row.gameId !== undefined &&
                row.seq !== undefined &&
                row.state !== undefined
                    ? buildGameStateSection({
                          gameId: row.gameId,
                          seq: row.seq,
                          state: row.state as Record<string, unknown>,
                      })
                    : null,
        });
        return {
            request: { ...request, labels: [...request.labels] },
            comment: buildBotFaultOccurrenceComment({
                reportId: row._id,
                fault: row.fault,
            }),
            priorGameReports: gameRows.filter(
                (r) => r.source === "system" && before(r)
            ).length,
            priorHourReports: hourRows.filter(before).length,
            knownIssueNumber: known?.issueNumber,
        };
    },
});

type SystemFilingContext = {
    request: { title: string; body: string; labels: string[] };
    comment: string;
    priorGameReports: number;
    priorHourReports: number;
    knownIssueNumber?: number;
};

/** Records why a system row reached no issue. */
export const markSystemReportSkipped = internalMutation({
    args: { reportId: v.id("bugReports"), reason: v.string() },
    returns: v.null(),
    handler: async (ctx, args) => {
        await ctx.db.patch(args.reportId, { filingSkipped: args.reason });
        return null;
    },
});

/**
 * Files (or groups) a system row on GitHub. Scheduled by
 * `recordSystemBugReport`; never throws on a GitHub failure — it records the
 * reason on the row instead, because nobody is waiting on this action to
 * surface an error to.
 */
export const fileSystemReportIssue = internalAction({
    args: { reportId: v.id("bugReports") },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        const skip = async (reason: string): Promise<null> => {
            await ctx.runMutation(internal.bugReports.markSystemReportSkipped, {
                reportId: args.reportId,
                reason,
            });
            return null;
        };
        const token = process.env.GITHUB_TOKEN;
        if (!token) return await skip("GITHUB_TOKEN missing");

        const filing: SystemFilingContext | null = await ctx.runQuery(
            internal.bugReports.getSystemFilingContext,
            { reportId: args.reportId }
        );
        if (!filing) return null;

        // The live state is read only when it can matter — never over a cap,
        // where the whole point is to spend no GitHub call.
        let existingIssue: { number: number; open: boolean } | null = null;
        if (
            systemReportCapReason(filing) === null &&
            filing.knownIssueNumber !== undefined
        ) {
            const res = await githubFetch(
                token,
                `issues/${filing.knownIssueNumber}`
            );
            const issue = res.ok
                ? ((await res.json()) as { state?: string })
                : null;
            // Only a definite answer reads as closed: a transient GitHub
            // error must not open a duplicate — it tries the comment, which
            // then fails into `filingSkipped` if GitHub is really down.
            existingIssue = {
                number: filing.knownIssueNumber,
                open: issue
                    ? issue.state === "open"
                    : res.status !== 404 && res.status !== 410,
            };
        }

        const plan = planSystemReportFiling({ ...filing, existingIssue });
        if (plan.kind === "skip") return await skip(plan.reason);

        const res: Response =
            plan.kind === "comment"
                ? await githubFetch(
                      token,
                      `issues/${plan.issueNumber}/comments`,
                      { body: filing.comment }
                  )
                : await githubFetch(token, "issues", filing.request);
        if (!res.ok) {
            const detail = await res.text().catch(() => "");
            return await skip(
                `GitHub API error (${res.status}): ${detail.slice(0, 200)}`
            );
        }
        const created = (await res.json()) as {
            html_url?: string;
            number?: number;
        };
        if (!created.html_url) {
            return await skip("GitHub API returned no URL");
        }
        await ctx.runMutation(internal.bugReports.attachIssueRef, {
            reportId: args.reportId,
            // A comment's response carries the COMMENT's url and no issue
            // number: the row links the issue it was grouped onto.
            issueNumber:
                plan.kind === "comment" ? plan.issueNumber : created.number,
            issueUrl: created.html_url,
        });
        return null;
    },
});
