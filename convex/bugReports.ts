import { ConvexError, v } from "convex/values";
import { action, mutation } from "./_generated/server";
import { getCurrentUserId } from "./auth";

// Bug-report intake. A floating in-app button (all routes) opens a dialog that
// collects a reporter name/email, a free-text description and an optional file,
// then files a GitHub issue on the tracker repo. The GitHub PAT is a secret and
// MUST NOT reach the client, so issue creation runs in a Convex `action`
// (network-capable) reading the token from `GITHUB_TOKEN` env. The optional
// attachment is uploaded to Convex storage first (client → `generateUploadUrl`)
// and embedded in the issue body as a link — the GitHub REST API cannot attach
// binary files to an issue directly.

const REPO = "fil-donadoni/tolaria";
const TRIAGE_LABEL = "needs-triage";
const DESCRIPTION_MAX = 8000;

export type IssueInput = {
    name: string;
    email: string;
    description: string;
    route?: string;
    userAgent?: string;
    attachmentUrl?: string | null;
    attachmentName?: string;
};

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

        const { title, body } = buildIssuePayload({
            name: args.name,
            email: args.email,
            description: args.description,
            route: args.route,
            userAgent: args.userAgent,
            attachmentUrl,
            attachmentName: args.attachmentName,
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
