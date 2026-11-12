/**
 * Admin notification email for a Bug Report (issue #9013).
 *
 * After the row is written and the GitHub filing ATTEMPTED (whatever its
 * outcome), `submitBugReport` schedules `notifyAdmins`: one email to every
 * user with `isAdmin === true`, read at send time (no recipient list in env).
 * The body carries the reporter's nickname, a description excerpt, the public
 * issue link when filing succeeded and the admin page link. It NEVER carries
 * the reporter's email or the attachment: `buildAdminNotification` takes
 * neither as input.
 *
 * A global cap of `NOTIFICATION_DAILY_CAP` notifications per UTC day protects
 * the password-reset OTP budget on Resend's free tier. Past it the email is
 * skipped and `skipped_cap` recorded on the row; the report and its issue are
 * untouched. A Resend failure is recorded (`failed`), never thrown into the
 * report.
 *
 * The sender is `sendResendEmail` (password-reset module): one endpoint, key
 * and `from`.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
    internalAction,
    internalMutation,
    internalQuery,
} from "./_generated/server";
import { resendDepsFromEnv, sendResendEmail } from "./resendOtpPasswordReset";

/** Notifications (one per report, fanned out to every admin) per UTC day. */
export const NOTIFICATION_DAILY_CAP = 20;
const EXCERPT_MAX = 300;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Epoch ms of 00:00 UTC of the day containing `now`. */
export function utcDayStart(now: number): number {
    return Math.floor(now / DAY_MS) * DAY_MS;
}

/** Whether another notification fits today, given the attempts already made. */
export function planNotification(attemptsToday: number): "send" | "skip" {
    return attemptsToday >= NOTIFICATION_DAILY_CAP ? "skip" : "send";
}

export interface AdminNotificationInput {
    nickname: string;
    description: string;
    /** Public issue URL; absent when the GitHub filing failed. */
    issueUrl?: string;
    reportId: string;
    siteUrl: string;
}

export function descriptionExcerpt(description: string): string {
    const flat = description.replace(/\s+/g, " ").trim();
    return flat.length > EXCERPT_MAX ? `${flat.slice(0, EXCERPT_MAX)}…` : flat;
}

/** The admin page link to one report. */
export function adminReportLink(siteUrl: string, reportId: string): string {
    return `${siteUrl.replace(/\/+$/, "")}/admin/bug-reports?report=${encodeURIComponent(reportId)}`;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** Subject, text and HTML of the notification. Pure. */
export function buildAdminNotification(input: AdminNotificationInput): {
    subject: string;
    text: string;
    html: string;
} {
    const excerpt = descriptionExcerpt(input.description);
    const adminLink = adminReportLink(input.siteUrl, input.reportId);
    const subject = `New Tolaria bug report from ${input.nickname}`;
    const text = [
        `${input.nickname} filed a bug report.`,
        "",
        excerpt,
        "",
        input.issueUrl
            ? `Issue: ${input.issueUrl}`
            : "The GitHub issue could not be filed.",
        `Report: ${adminLink}`,
    ].join("\n");
    const issueLine = input.issueUrl
        ? `<p><a href="${escapeHtml(input.issueUrl)}">Issue</a></p>`
        : "<p>The GitHub issue could not be filed.</p>";
    const html = `<!doctype html>
<html><body style="font-family:ui-sans-serif,system-ui,sans-serif;">
<h1 style="font-size:18px;">New bug report</h1>
<p><strong>${escapeHtml(input.nickname)}</strong> filed a bug report.</p>
<blockquote>${escapeHtml(excerpt)}</blockquote>
${issueLine}
<p><a href="${escapeHtml(adminLink)}">Open the report</a></p>
</body></html>`;
    return { subject, text, html };
}

/** Emails of every admin, read at send time. */
export const adminRecipients = internalQuery({
    args: {},
    returns: v.array(v.string()),
    handler: async (ctx) => {
        const admins = await ctx.db
            .query("users")
            .withIndex("by_isAdmin", (q) => q.eq("isAdmin", true))
            .collect();
        return admins
            .filter((u) => u.isAdmin === true)
            .map((u) => u.email)
            .filter((e): e is string => typeof e === "string" && e !== "");
    },
});

/** What the email needs from the row — never its `email` or attachment. */
export const getNotificationContext = internalQuery({
    args: { reportId: v.id("bugReports") },
    returns: v.union(
        v.null(),
        v.object({
            nickname: v.string(),
            description: v.string(),
            issueUrl: v.optional(v.string()),
        })
    ),
    handler: async (ctx, { reportId }) => {
        const row = await ctx.db.get(reportId);
        if (!row) return null;
        const user = row.userId ? await ctx.db.get(row.userId) : null;
        return {
            nickname: user?.nickname ?? row.name,
            description: row.description,
            issueUrl: row.issueUrl,
        };
    },
});

/**
 * Takes one slot of today's cap, in one transaction (concurrent reports
 * cannot both slip under it). `true` → the caller sends; `false` → skipped and
 * recorded on the row.
 */
export const reserveNotification = internalMutation({
    args: { reportId: v.id("bugReports") },
    returns: v.boolean(),
    handler: async (ctx, { reportId }) => {
        const now = Date.now();
        const attempts = await ctx.db
            .query("bugReports")
            .withIndex("by_notifiedAt", (q) =>
                q.gte("notifiedAt", utcDayStart(now))
            )
            .collect();
        if (planNotification(attempts.length) === "skip") {
            await ctx.db.patch(reportId, { notification: "skipped_cap" });
            return false;
        }
        await ctx.db.patch(reportId, { notifiedAt: now });
        return true;
    },
});

export const recordNotification = internalMutation({
    args: {
        reportId: v.id("bugReports"),
        outcome: v.union(v.literal("sent"), v.literal("failed")),
    },
    returns: v.null(),
    handler: async (ctx, { reportId, outcome }) => {
        await ctx.db.patch(reportId, { notification: outcome });
        return null;
    },
});

export interface NotifyDeps {
    reserve: () => Promise<boolean>;
    load: () => Promise<{
        nickname: string;
        description: string;
        issueUrl?: string;
    } | null>;
    recipients: () => Promise<string[]>;
    send: (message: {
        to: string[];
        subject: string;
        text: string;
        html: string;
    }) => Promise<void>;
    record: (outcome: "sent" | "failed") => Promise<void>;
    siteUrl: string | undefined;
    reportId: string;
}

/** One notification: reserve a cap slot, mail every admin, record the outcome.
 *  A send error is recorded as `failed` and never thrown — the report is
 *  already filed. Returns what was recorded, or `skipped_cap`. */
export async function deliverNotification(
    deps: NotifyDeps
): Promise<"sent" | "failed" | "skipped_cap"> {
    if (!(await deps.reserve())) return "skipped_cap";
    let outcome: "sent" | "failed" = "failed";
    try {
        const row = await deps.load();
        const recipients = await deps.recipients();
        if (row && deps.siteUrl && recipients.length > 0) {
            const message = buildAdminNotification({
                nickname: row.nickname,
                description: row.description,
                issueUrl: row.issueUrl,
                reportId: deps.reportId,
                siteUrl: deps.siteUrl,
            });
            await Promise.all(
                recipients.map((to) => deps.send({ to: [to], ...message }))
            );
            outcome = "sent";
        }
    } catch (err) {
        console.error(
            `bugReportNotify: report ${deps.reportId}: ${(err as Error).message}`
        );
    }
    await deps.record(outcome);
    return outcome;
}

export const notifyAdmins = internalAction({
    args: { reportId: v.id("bugReports") },
    returns: v.null(),
    handler: async (ctx, { reportId }) => {
        const resend = resendDepsFromEnv();
        await deliverNotification({
            reportId,
            siteUrl: process.env.SITE_URL,
            reserve: () =>
                ctx.runMutation(internal.bugReportNotify.reserveNotification, {
                    reportId,
                }),
            load: () =>
                ctx.runQuery(internal.bugReportNotify.getNotificationContext, {
                    reportId,
                }),
            recipients: () =>
                ctx.runQuery(internal.bugReportNotify.adminRecipients, {}),
            send: (message) =>
                sendResendEmail(resend, message, "bug-report notification"),
            record: async (outcome) => {
                await ctx.runMutation(
                    internal.bugReportNotify.recordNotification,
                    { reportId, outcome }
                );
            },
        });
        return null;
    },
});
