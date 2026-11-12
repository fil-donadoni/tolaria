// Admin notification email for a Bug Report (issue #9013): recipients are the
// admins only, the body never carries the reporter's email or the attachment,
// the 21st notification of a UTC day is skipped and recorded, a filing failure
// still mails the admin link, and a Resend failure never throws.
// Registered handlers are driven through `_handler` against stub contexts
// (this repo has no convex-test harness).
import { describe, it, expect, vi } from "vitest";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
    NOTIFICATION_DAILY_CAP,
    adminRecipients,
    buildAdminNotification,
    deliverNotification,
    getNotificationContext,
    planNotification,
    reserveNotification,
    utcDayStart,
    type NotifyDeps,
} from "../bugReportNotify";
import { buildIssueRequest } from "../bugReports";
import type { Id } from "../_generated/dataModel";

type Row = Record<string, unknown>;
type Handler<C, A, R> = { _handler: (ctx: C, args: A) => Promise<R> };

function indexQuery(table: Row[]) {
    return {
        withIndex: (_n: string, fn: (q: unknown) => unknown) => {
            const preds: ((r: Row) => boolean)[] = [];
            const q = {
                eq: (f: string, v: unknown) => {
                    preds.push((r) => r[f] === v);
                    return q;
                },
                gte: (f: string, v: number) => {
                    preds.push(
                        (r) => typeof r[f] === "number" && (r[f] as number) >= v
                    );
                    return q;
                },
            };
            fn(q);
            return {
                collect: async () =>
                    table.filter((r) => preds.every((p) => p(r))),
            };
        },
    };
}

describe("filed issue labels (issue #9013)", () => {
    it("every report is stamped needs-triage and never ready-for-agent", () => {
        const request = buildIssueRequest({
            name: "Ada",
            description: "Freeze",
            gameSection: null,
            reportId: "rep1" as Id<"bugReports">,
        });
        expect(request.labels).toContain("user-report");
        expect(request.labels).toContain("needs-triage");
        expect(request.labels).not.toContain("ready-for-agent");
    });
});

describe("adminRecipients", () => {
    it("returns admins' emails and no non-admin", async () => {
        const users: Row[] = [
            { _id: "u1", isAdmin: true, email: "root@example.com" },
            { _id: "u2", isAdmin: false, email: "player@example.com" },
            { _id: "u3", email: "tester@example.com" },
            { _id: "u4", isAdmin: true },
        ];
        const ctx = {
            db: { query: () => indexQuery(users) },
        } as unknown as QueryCtx;
        const out = await (
            adminRecipients as unknown as Handler<QueryCtx, object, string[]>
        )._handler(ctx, {});
        expect(out).toEqual(["root@example.com"]);
    });
});

describe("daily cap", () => {
    it("planNotification: 20 fit, the 21st skips", () => {
        expect(planNotification(NOTIFICATION_DAILY_CAP - 1)).toBe("send");
        expect(planNotification(NOTIFICATION_DAILY_CAP)).toBe("skip");
    });

    it("utcDayStart is 00:00 UTC", () => {
        const t = Date.UTC(2026, 10, 12, 23, 59);
        expect(utcDayStart(t)).toBe(Date.UTC(2026, 10, 12));
    });

    it("the 21st notification of a UTC day is skipped and recorded", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(Date.UTC(2026, 10, 12, 10));
        try {
            const table: Row[] = Array.from({ length: 20 }, (_, i) => ({
                _id: `old-${i}`,
                notifiedAt: Date.UTC(2026, 10, 12, 1),
            }));
            // Yesterday's attempts must not count.
            table.push({ _id: "y", notifiedAt: Date.UTC(2026, 10, 11, 23) });
            table.push({ _id: "new" });
            const patches: Row[] = [];
            const ctx = {
                db: {
                    query: () => indexQuery(table),
                    patch: async (id: string, p: Row) => {
                        patches.push({ id, ...p });
                    },
                },
            } as unknown as MutationCtx;
            const reserve = (reportId: string) =>
                (
                    reserveNotification as unknown as Handler<
                        MutationCtx,
                        { reportId: string },
                        boolean
                    >
                )._handler(ctx, { reportId });
            expect(await reserve("new")).toBe(false);
            expect(patches).toEqual([
                { id: "new", notification: "skipped_cap" },
            ]);
            table.splice(0, 1); // 19 today → a slot is free
            expect(await reserve("new")).toBe(true);
            expect(patches[1]).toMatchObject({ id: "new" });
            expect(patches[1]!.notifiedAt).toBe(Date.now());
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("email body", () => {
    const base = {
        nickname: "Ada",
        description: "Board freezes\non attack",
        reportId: "rep1",
        siteUrl: "https://tolaria.example/",
    };

    it("carries nickname, excerpt, issue link and the admin link", () => {
        const m = buildAdminNotification({
            ...base,
            issueUrl: "https://github.com/o/r/issues/5",
        });
        for (const body of [m.text, m.html]) {
            expect(body).toContain("Ada");
            expect(body).toContain("Board freezes on attack");
            expect(body).toContain("https://github.com/o/r/issues/5");
            expect(body).toContain(
                "https://tolaria.example/admin/bug-reports?report=rep1"
            );
        }
    });

    it("filing failed: admin link only, no issue link", () => {
        const m = buildAdminNotification(base);
        expect(m.text).not.toContain("github.com");
        expect(m.text).toContain("/admin/bug-reports?report=rep1");
    });

    it("never contains the reporter's email or the attachment", async () => {
        const row: Row = {
            _id: "rep1",
            name: "Ada",
            email: "ada.secret@example.com",
            description: "Freeze",
            attachmentName: "crash-dump.zip",
            attachmentId: "storage-1",
            issueUrl: "https://github.com/o/r/issues/5",
        };
        const ctx = {
            db: { get: async (id: string) => (id === "rep1" ? row : null) },
        } as unknown as QueryCtx;
        const context = await (
            getNotificationContext as unknown as Handler<
                QueryCtx,
                { reportId: string },
                { nickname: string; description: string; issueUrl?: string }
            >
        )._handler(ctx, { reportId: "rep1" });
        const m = buildAdminNotification({
            ...context!,
            reportId: "rep1",
            siteUrl: "https://tolaria.example",
        });
        const all = JSON.stringify(m);
        expect(all).not.toContain("ada.secret@example.com");
        expect(all).not.toContain("crash-dump");
        expect(all).not.toContain("storage-1");
    });
});

describe("deliverNotification", () => {
    function deps(over: Partial<NotifyDeps> = {}) {
        const sent: { to: string[]; text: string }[] = [];
        const recorded: string[] = [];
        const d: NotifyDeps = {
            reportId: "rep1",
            siteUrl: "https://tolaria.example",
            reserve: async () => true,
            load: async () => ({ nickname: "Ada", description: "Freeze" }),
            recipients: async () => ["a@x.com", "b@x.com"],
            send: async (m) => {
                sent.push(m);
            },
            record: async (o) => {
                recorded.push(o);
            },
            ...over,
        };
        return { d, sent, recorded };
    }

    it("sends one email to each admin and records sent", async () => {
        const { d, sent, recorded } = deps();
        expect(await deliverNotification(d)).toBe("sent");
        expect(sent.map((m) => m.to)).toEqual([["a@x.com"], ["b@x.com"]]);
        expect(recorded).toEqual(["sent"]);
    });

    it("is still sent, admin link only, when GitHub filing failed", async () => {
        const { d, sent } = deps({
            load: async () => ({
                nickname: "Ada",
                description: "Freeze",
                issueUrl: undefined,
            }),
        });
        await deliverNotification(d);
        expect(sent).toHaveLength(2);
        expect(sent[0]!.text).toContain("/admin/bug-reports?report=rep1");
        expect(sent[0]!.text).not.toContain("github.com");
    });

    it("past the cap: nothing is sent or re-recorded", async () => {
        const { d, sent, recorded } = deps({ reserve: async () => false });
        expect(await deliverNotification(d)).toBe("skipped_cap");
        expect(sent).toEqual([]);
        expect(recorded).toEqual([]);
    });

    it("a Resend failure is recorded as failed and never thrown", async () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { d, recorded } = deps({
                send: async () => {
                    throw new Error("Resend rejected (403)");
                },
            });
            expect(await deliverNotification(d)).toBe("failed");
            expect(recorded).toEqual(["failed"]);
        } finally {
            err.mockRestore();
        }
    });
});

// ── submitBugReport schedules the notification after the filing attempt ──
import { afterEach } from "vitest";
import { attachIssueRef, submitBugReport } from "../bugReports";
import { getFunctionName } from "convex/server";
import { internal } from "../_generated/api";

describe("submitBugReport → notification (issue #9013)", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        delete process.env.GITHUB_TOKEN;
    });

    function actionCtx() {
        const scheduled: { fn: string; args: unknown }[] = [];
        const ctx = {
            auth: { getUserIdentity: async () => ({ subject: "u|s" }) },
            runQuery: async () => null,
            runMutation: async () => "rep1",
            scheduler: {
                runAfter: async (_ms: number, fn: unknown, args: unknown) => {
                    scheduled.push({
                        fn: getFunctionName(fn as never),
                        args,
                    });
                },
            },
        };
        return { ctx, scheduled };
    }
    const run = (ctx: unknown) =>
        (
            submitBugReport as unknown as {
                _handler: (c: unknown, a: unknown) => Promise<unknown>;
            }
        )._handler(ctx, {
            name: "Ada",
            email: "ada@example.com",
            description: "Freeze",
            diagnosticsConsent: false,
        });
    const wanted = getFunctionName(internal.bugReportNotify.notifyAdmins);

    it("schedules after a successful filing", async () => {
        process.env.GITHUB_TOKEN = "t";
        vi.stubGlobal(
            "fetch",
            async () =>
                new Response(
                    JSON.stringify({ html_url: "https://gh/1", number: 1 }),
                    { status: 201 }
                )
        );
        const { ctx, scheduled } = actionCtx();
        await run(ctx);
        expect(scheduled).toEqual([{ fn: wanted, args: { reportId: "rep1" } }]);
    });

    it("schedules even when the GitHub filing fails, and still throws", async () => {
        process.env.GITHUB_TOKEN = "t";
        vi.stubGlobal(
            "fetch",
            async () => new Response("down", { status: 503 })
        );
        const { ctx, scheduled } = actionCtx();
        await expect(run(ctx)).rejects.toThrow(/GitHub API error/);
        expect(scheduled).toHaveLength(1);
        expect(scheduled[0]!.fn).toBe(wanted);
    });

    it("attachIssueRef stamps a new filing as open", async () => {
        const patches: Row[] = [];
        const ctx = {
            db: {
                patch: async (_id: string, p: Row) => {
                    patches.push(p);
                },
            },
        } as unknown as MutationCtx;
        await (
            attachIssueRef as unknown as Handler<MutationCtx, unknown, null>
        )._handler(ctx, {
            reportId: "rep1",
            issueNumber: 9,
            issueUrl: "https://gh/9",
        });
        expect(patches[0]).toMatchObject({
            issueNumber: 9,
            issueState: "open",
        });
    });
});
