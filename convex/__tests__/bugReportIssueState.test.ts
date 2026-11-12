// GitHub issue state sync for Bug Report rows (issue #9013): mapping, row
// matching by issue number, pagination, and the `since` cursor advancing only
// after a full successful read.
import { describe, it, expect } from "vitest";
import type { MutationCtx } from "../_generated/server";
import {
    applyIssueStates,
    deriveGithubState,
    fetchChangedIssues,
    isClosedReport,
    mapIssueState,
    runIssueStateSync,
    type IssueStateSyncDeps,
} from "../bugReportIssueState";

describe("mapIssueState", () => {
    it("open", () => {
        expect(mapIssueState({ number: 1, state: "open" })).toEqual({
            issueNumber: 1,
            issueState: "open",
        });
    });
    it("closed completed / not planned", () => {
        const closed = "2026-11-10T10:00:00Z";
        expect(
            mapIssueState({
                number: 2,
                state: "closed",
                state_reason: "completed",
                closed_at: closed,
            })
        ).toEqual({
            issueNumber: 2,
            issueState: "closed",
            issueCloseReason: "completed",
            issueClosedAt: Date.parse(closed),
        });
        expect(
            mapIssueState({
                number: 3,
                state: "closed",
                state_reason: "not_planned",
                closed_at: closed,
            }).issueCloseReason
        ).toBe("not_planned");
        // An old issue closed with no reason reads as completed.
        expect(
            mapIssueState({ number: 4, state: "closed", state_reason: null })
        ).toMatchObject({ issueCloseReason: "completed" });
    });
});

describe("deriveGithubState", () => {
    it("not filed / open / closed variants", () => {
        expect(deriveGithubState({})).toBe("not_filed");
        expect(deriveGithubState({ issueNumber: 1 })).toBe("open");
        expect(
            deriveGithubState({ issueNumber: 1, issueState: "closed" })
        ).toBe("closed_completed");
        expect(
            deriveGithubState({
                issueNumber: 1,
                issueState: "closed",
                issueCloseReason: "not_planned",
            })
        ).toBe("closed_not_planned");
    });
    it("an unfiled report is never in the closed history", () => {
        expect(isClosedReport({})).toBe(false);
        expect(isClosedReport({ issueNumber: 1, issueState: "closed" })).toBe(
            true
        );
    });
});

function page(from: number, count: number) {
    return Array.from({ length: count }, (_, i) => ({
        number: from + i,
        state: "open",
    }));
}

describe("fetchChangedIssues", () => {
    it("follows pagination, drops pull requests, passes `since`", async () => {
        const urls: string[] = [];
        const pages = [
            [...page(1, 99), { number: 200, state: "open", pull_request: {} }],
            page(101, 3),
        ];
        const fetchImpl = (async (url: string) => {
            urls.push(url);
            return new Response(JSON.stringify(pages[urls.length - 1]));
        }) as unknown as typeof fetch;
        const out = await fetchChangedIssues(
            fetchImpl,
            "t",
            "2026-11-01T00:00:00Z"
        );
        expect(out).toHaveLength(102);
        expect(urls).toHaveLength(2);
        expect(urls[0]).toContain("labels=user-report");
        expect(urls[0]).toContain("since=2026-11-01T00%3A00%3A00Z");
        expect(urls[1]).toContain("page=2");
    });

    it("throws on a failed page", async () => {
        const fetchImpl = (async () =>
            new Response("no", { status: 502 })) as unknown as typeof fetch;
        await expect(
            fetchChangedIssues(fetchImpl, "t", undefined)
        ).rejects.toThrow(/502/);
    });
});

describe("runIssueStateSync cursor", () => {
    function deps(over: Partial<IssueStateSyncDeps> = {}) {
        const log = {
            applied: [] as unknown[],
            cursor: undefined as string | undefined,
        };
        const d: IssueStateSyncDeps = {
            fetchImpl: (async () =>
                new Response(
                    JSON.stringify(page(1, 2))
                )) as unknown as typeof fetch,
            token: "t",
            now: () => Date.UTC(2026, 10, 12, 10),
            getCursor: async () => undefined,
            apply: async (p) => {
                log.applied.push(...p);
            },
            setCursor: async (since) => {
                log.cursor = since;
            },
            ...over,
        };
        return { d, log };
    }

    it("advances the cursor to the run's start after a full read", async () => {
        const { d, log } = deps();
        expect(await runIssueStateSync(d)).toBe(2);
        expect(log.applied).toHaveLength(2);
        expect(log.cursor).toBe("2026-11-12T10:00:00.000Z");
    });

    it("a failed read leaves the cursor and writes nothing", async () => {
        const { d, log } = deps({
            fetchImpl: (async () =>
                new Response("x", { status: 500 })) as unknown as typeof fetch,
        });
        await expect(runIssueStateSync(d)).rejects.toThrow();
        expect(log.cursor).toBeUndefined();
        expect(log.applied).toEqual([]);
    });

    it("a failed write leaves the cursor", async () => {
        const { d, log } = deps({
            apply: async () => {
                throw new Error("write");
            },
        });
        await expect(runIssueStateSync(d)).rejects.toThrow("write");
        expect(log.cursor).toBeUndefined();
    });

    it("no token: skipped", async () => {
        const { d } = deps({ token: undefined });
        expect(await runIssueStateSync(d)).toBe("skipped");
    });
});

describe("applyIssueStates handler", () => {
    it("patches rows by issue number and ignores issues with no row", async () => {
        const rows = [
            { _id: "r1", issueNumber: 7, issueState: "open" },
            {
                _id: "r2",
                issueNumber: 8,
                issueState: "closed",
                issueClosedAt: 1,
            },
        ];
        const patches: Record<string, unknown>[] = [];
        const ctx = {
            db: {
                query: () => ({
                    withIndex: (_n: string, fn: (q: unknown) => unknown) => {
                        let want: unknown;
                        fn({
                            eq: (_f: string, v: unknown) => {
                                want = v;
                            },
                        });
                        return {
                            collect: async () =>
                                rows.filter((r) => r.issueNumber === want),
                        };
                    },
                }),
                patch: async (id: string, p: Record<string, unknown>) => {
                    patches.push({ id, ...p });
                },
            },
        } as unknown as MutationCtx;
        const written = await (
            applyIssueStates as unknown as {
                _handler: (c: MutationCtx, a: unknown) => Promise<number>;
            }
        )._handler(ctx, {
            patches: [
                {
                    issueNumber: 7,
                    issueState: "closed",
                    issueCloseReason: "completed",
                    issueClosedAt: 5,
                },
                { issueNumber: 8, issueState: "open" },
                { issueNumber: 999, issueState: "open" },
            ],
            syncedAt: 42,
        });
        expect(written).toBe(2);
        expect(patches[0]).toMatchObject({
            id: "r1",
            issueState: "closed",
            issueCloseReason: "completed",
            issueSyncedAt: 42,
        });
        // A reopened issue drops its close fields.
        expect(patches[1]).toMatchObject({ id: "r2", issueState: "open" });
        expect(patches[1]!.issueCloseReason).toBeUndefined();
        expect(patches[1]!.issueClosedAt).toBeUndefined();
    });
});
