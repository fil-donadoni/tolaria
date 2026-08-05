import { ConvexError, v } from "convex/values";
import { action, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
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
// A report filed FROM a game also carries that game's state (issue #1728). Most
// in-app reports are about something happening on the board right now, and the
// free-text description is almost never enough to act on: #1728 was "Oppo
// continua a pensare e non si sblocca" and nothing else — no card, no phase, no
// game id — which is exactly the information the state row already holds. The
// snapshot is read SERVER-SIDE from `gameStates` (the client passes only a
// `gameId`, and only a participant of that game can read it), so a report can
// neither forge a state nor harvest someone else's.

const REPO = "fil-donadoni/tolaria";
const TRIAGE_LABEL = "needs-triage";
const DESCRIPTION_MAX = 8000;

/** Cap on the minified state JSON embedded in the issue body. A `gameStates`
 *  row measures 3–9 KB compact and expands to well under this, so the cap is a
 *  backstop, not the normal path: GitHub rejects an issue body over 65536
 *  characters, and a rejected POST would lose the whole report — including the
 *  user's own words — over an attachment they never asked for. Over the cap the
 *  state is dropped and the omission is stated in the body. */
const GAME_STATE_JSON_MAX = 50000;

export type IssueInput = {
    name: string;
    email: string;
    description: string;
    route?: string;
    userAgent?: string;
    attachmentUrl?: string | null;
    attachmentName?: string;
    gameSection?: string | null;
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
 * Pure renderer for the game-state section of the issue body. Emits a
 * human-readable header (what a maintainer needs to know at a glance) followed
 * by the full state as minified JSON inside a collapsed `<details>` — collapsed
 * so several KB of JSON does not bury the reporter's own description, and
 * fenced as `json` so the agent that later triages the issue can lift it out
 * without guessing where it starts.
 *
 * Over `GAME_STATE_JSON_MAX` the JSON is dropped and the omission is stated:
 * silently truncating it would produce invalid JSON that reads as complete.
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

    const json = JSON.stringify(state);
    if (json.length > GAME_STATE_JSON_MAX) {
        lines.push(
            "",
            `_Game state omitted: ${json.length} characters exceeds the ${GAME_STATE_JSON_MAX}-character cap._`
        );
        return lines.join("\n");
    }

    lines.push(
        "",
        "<details><summary>Game state (JSON)</summary>",
        "",
        "```json",
        json,
        "```",
        "",
        "</details>"
    );
    return lines.join("\n");
}

/**
 * Pure GitHub-issue payload builder — kept free of Convex/network so it can be
 * unit-tested directly (the project has no convex-test harness). Derives the
 * title from the first line of the description and appends a reporter/context
 * footer plus an optional attachment link. Throws `ConvexError` on an
 * empty/oversized description — a plain `Error` message is stripped by Convex
 * in production and reaches the client as a bare "Server Error".
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
    const email = input.email.trim() || "n/a";

    // First line of the description seeds the issue title (trimmed to a sane
    // length); fall back to a generic title for an empty first line.
    const firstLine = description.split("\n")[0]!.trim();
    const title = firstLine
        ? `[Bug] ${firstLine.slice(0, 120)}`
        : "[Bug] In-app report";

    const bodyLines = [
        description,
        "",
        "---",
        `**Reporter:** ${name} (${email})`,
    ];
    if (input.route) bodyLines.push(`**Route:** \`${input.route}\``);
    if (input.userAgent) {
        bodyLines.push(`**User agent:** ${input.userAgent}`);
    }
    if (input.attachmentUrl) {
        const label = input.attachmentName ?? "attachment";
        bodyLines.push(`**Attachment:** [${label}](${input.attachmentUrl})`);
    }
    if (input.gameSection) bodyLines.push("", input.gameSection);
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
 * client supplies a `gameId` it cannot be trusted with, and the issue this
 * feeds is filed on a PUBLIC repo, so a missing check here would let anyone
 * publish any game's hidden zones by filing a report against its id.
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

        // Resolve the optional attachment to a public URL for the issue body.
        const attachmentUrl = args.attachmentId
            ? await ctx.storage.getUrl(args.attachmentId)
            : null;

        // The snapshot is best-effort: a report filed from the lobby has no
        // gameId, and a game that has not started has no state row. Neither is
        // a reason to fail the report.
        const snapshot = args.gameId
            ? await ctx.runQuery(internal.bugReports.getGameSnapshotForReport, {
                  gameId: args.gameId,
              })
            : null;

        const { title, body } = buildIssuePayload({
            name: args.name,
            email: args.email,
            description: args.description,
            route: args.route,
            userAgent: args.userAgent,
            attachmentUrl,
            attachmentName: args.attachmentName,
            gameSection: snapshot ? buildGameStateSection(snapshot) : null,
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

        const issue = (await res.json()) as { html_url?: string };
        if (!issue.html_url) {
            throw new ConvexError("GitHub API returned no issue URL");
        }
        return { issueUrl: issue.html_url };
    },
});
