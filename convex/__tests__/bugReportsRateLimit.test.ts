// Bug-report rate limit (issue #4076): 5 reports per user per rolling hour,
// enforced in `createReportRow` before the insert. Drives the REGISTERED
// internalMutation's `_handler` against a stub ctx (this repo has no
// convex-test harness) whose `bugReports` table honours `by_userId` with
// `eq(userId)` + `gt(_creationTime)`, and stamps `_creationTime` from the
// faked clock so the window is exercised, not assumed.
import { describe, it, expect, afterEach, vi } from "vitest";
import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import { createReportRow } from "../bugReports";
import {
    REPORT_RATE_LIMITED_CODE,
    REPORT_WINDOW_MS,
    isReportRateLimitedData,
} from "../bugReportRateLimit";

type Row = Record<string, unknown> & { _creationTime: number };

function makeCtx(userId: string, table: Row[]): MutationCtx {
    let seq = 0;
    return {
        auth: {
            getUserIdentity: async () => ({ subject: `${userId}|session1` }),
        },
        db: {
            insert: async (_t: string, doc: Record<string, unknown>) => {
                const _id = `report-${++seq}`;
                table.push({ ...doc, _id, _creationTime: Date.now() });
                return _id;
            },
            patch: async () => undefined,
            query: () => ({
                withIndex: (_n: string, fn: (q: unknown) => unknown) => {
                    const preds: ((r: Row) => boolean)[] = [];
                    const q = {
                        eq: (f: string, v: unknown) => {
                            preds.push((r) => r[f] === v);
                            return q;
                        },
                        gt: (f: string, v: number) => {
                            preds.push((r) => (r[f] as number) > v);
                            return q;
                        },
                    };
                    fn(q);
                    return {
                        collect: async () =>
                            table.filter((r) => preds.every((p) => p(r))),
                    };
                },
            }),
        },
    } as unknown as MutationCtx;
}

const file = (ctx: MutationCtx) =>
    (
        createReportRow as unknown as {
            _handler: (ctx: MutationCtx, a: unknown) => Promise<string>;
        }
    )._handler(ctx, { name: "Ada", email: "a@b.c", description: "bug" });

const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);

afterEach(() => vi.useRealTimers());

describe("bug-report rate limit (issue #4076)", () => {
    it("allows the 5th report in an hour and refuses the 6th with retryAt, persisting nothing", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(T0);
        const table: Row[] = [];
        const ctx = makeCtx("u1", table);
        for (let i = 0; i < 5; i++) {
            vi.setSystemTime(T0 + i * 60_000);
            await file(ctx);
        }
        expect(table).toHaveLength(5);

        vi.setSystemTime(T0 + 10 * 60_000);
        const err = await file(ctx).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ConvexError);
        const data = (err as ConvexError<unknown>).data;
        expect(isReportRateLimitedData(data)).toBe(true);
        expect(data).toEqual({
            code: REPORT_RATE_LIMITED_CODE,
            retryAt: T0 + REPORT_WINDOW_MS,
        });
        expect(table).toHaveLength(5);
    });

    it("allows a report again once the oldest has left the window", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(T0);
        const table: Row[] = [];
        const ctx = makeCtx("u1", table);
        for (let i = 0; i < 5; i++) await file(ctx);

        vi.setSystemTime(T0 + REPORT_WINDOW_MS - 1);
        await expect(file(ctx)).rejects.toBeInstanceOf(ConvexError);

        vi.setSystemTime(T0 + REPORT_WINDOW_MS);
        await file(ctx);
        expect(table).toHaveLength(6);
    });

    it("counts per user: another user is unaffected", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(T0);
        const table: Row[] = [];
        for (let i = 0; i < 5; i++) await file(makeCtx("u1", table));
        await expect(file(makeCtx("u1", table))).rejects.toBeInstanceOf(
            ConvexError
        );
        await file(makeCtx("u2", table));
        expect(table.filter((r) => r.userId === "u2")).toHaveLength(1);
    });
});
