// Admin gate for the two public bug-report queries (issue #2250).
//
// `getReport` (the pre-existing query) is `internalQuery`-only, so the admin
// UI needs its own public entry points — `listBugReports` / `getBugReport` —
// each `assertIsAdmin`-gated (ADR 0033). The project's existing convention
// (`adminAuth.test.ts`, `decks.test.ts`) only re-asserts the pure
// `isAdminUser` predicate, which proves the PREDICATE works but not that
// these two queries actually CALL it — a query that forgot the gate would
// pass that test suite unnoticed. This file drives each REGISTERED query
// binding's own `_handler` (the function Convex actually deploys) against a
// stub `QueryCtx`, same technique as `debugMutationAdminCensus.test.ts` /
// `debugBo3Sideboard.test.ts` (this repo has no convex-test harness).
//
// Earlier revision imported the bare EXTRACTED `listBugReportsHandler` /
// `getBugReportHandler` functions instead of the registered `listBugReports`
// / `getBugReport` bindings — that drives the gate logic, but proves nothing
// about whether the `query({ ..., handler })` registration actually wires
// that function in. A reviewer confirmed the gap by swapping the
// registration's `handler:` for an inline, ungated closure doing the same
// read: `listBugReportsHandler` still worked (it isn't called anymore), and
// this suite stayed green while the deployed query leaked every report to
// any signed-in caller. Driving `(listBugReports as ...)._handler` instead
// closes that gap — it is the exact object Convex invokes at the RPC.
import { describe, it, expect } from "vitest";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { listBugReports, getBugReport } from "../bugReports";

type Handler<A, R> = { _handler: (ctx: QueryCtx, args: A) => Promise<R> };

const runListBugReports = (ctx: QueryCtx) =>
    (
        listBugReports as unknown as Handler<Record<string, never>, unknown>
    )._handler(ctx, {});

const runGetBugReport = (ctx: QueryCtx, args: { reportId: Id<"bugReports"> }) =>
    (getBugReport as unknown as Handler<typeof args, unknown>)._handler(
        ctx,
        args
    );

type Row = Record<string, unknown>;

/** Minimal stub `QueryCtx`: `auth.getUserIdentity` (subject encodes the user
 *  id the same way `@convex-dev/auth`'s `getUserId` decodes it, `id|
 *  session`), `db.get`/`db.query(...).order().collect()` over an in-memory
 *  table, and `storage.getUrl`. Scoped to exactly what `listBugReportsHandler`
 *  / `getBugReportHandler` read — `bugReports` has no by-index query, so this
 *  intentionally does NOT support `.withIndex(...)` the way the shared
 *  `gameMutationHarness` stub does. */
function makeCtx(userId: string | null, docs: Row[]): QueryCtx {
    const byId = new Map(docs.map((d) => [d._id as string, d]));
    const ctx = {
        auth: {
            getUserIdentity: async () =>
                userId === null ? null : { subject: `${userId}|session1` },
        },
        db: {
            get: async (id: string) => byId.get(id) ?? null,
            query: (table: string) => {
                const rows = docs.filter((d) => d.__table === table);
                return {
                    order: () => ({ collect: async () => rows }),
                    collect: async () => rows,
                };
            },
        },
        storage: {
            getUrl: async () => "https://example.com/attachment",
        },
    };
    return ctx as unknown as QueryCtx;
}

const ADMIN: Row = { _id: "admin-1", __table: "users", isAdmin: true };
const NON_ADMIN: Row = { _id: "user-1", __table: "users", isAdmin: false };

const REPORT: Row = {
    _id: "report-1",
    __table: "bugReports",
    _creationTime: 1000,
    userId: "admin-1",
    name: "Ada",
    email: "ada@example.com",
    description: "Board freezes on attack\nmore detail below",
    state: { turn: 3, phase: "COMBAT" },
};

describe("listBugReports / getBugReport admin gate (issue #2250)", () => {
    it("rejects an unauthenticated caller on both queries", async () => {
        const ctx = makeCtx(null, [REPORT]);
        await expect(runListBugReports(ctx)).rejects.toThrow(/admin only/i);
        await expect(
            runGetBugReport(ctx, {
                reportId: "report-1" as Id<"bugReports">,
            })
        ).rejects.toThrow(/admin only/i);
    });

    it("rejects an authenticated non-admin caller on both queries", async () => {
        const ctx = makeCtx("user-1", [NON_ADMIN, REPORT]);
        await expect(runListBugReports(ctx)).rejects.toThrow(/admin only/i);
        await expect(
            runGetBugReport(ctx, {
                reportId: "report-1" as Id<"bugReports">,
            })
        ).rejects.toThrow(/admin only/i);
    });

    it("allows an admin through listBugReports, and never puts state on the returned rows", async () => {
        const ctx = makeCtx("admin-1", [ADMIN, REPORT]);
        const rows = (await runListBugReports(ctx)) as Row[];
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual({
            _id: "report-1",
            filedAt: 1000,
            name: "Ada",
            descriptionPreview: "Board freezes on attack",
            issueNumber: undefined,
            hasSnapshot: true,
            hasAttachment: false,
        });
        expect(rows[0]).not.toHaveProperty("state");
    });

    it("allows an admin through getBugReport, including the full state", async () => {
        const ctx = makeCtx("admin-1", [ADMIN, REPORT]);
        const result = (await runGetBugReport(ctx, {
            reportId: "report-1" as Id<"bugReports">,
        })) as Row | null;
        expect(result).not.toBeNull();
        expect(result?.email).toBe("ada@example.com");
        expect(result?.state).toEqual({ turn: 3, phase: "COMBAT" });
        expect(result?.attachmentUrl).toBeNull();
    });

    it("returns null from getBugReport for a missing row, after the gate passes", async () => {
        const ctx = makeCtx("admin-1", [ADMIN]);
        const result = await runGetBugReport(ctx, {
            reportId: "missing" as Id<"bugReports">,
        });
        expect(result).toBeNull();
    });
});
