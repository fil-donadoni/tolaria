import { describe, it, expect } from "vitest";
import {
    isRateLimitFailure,
    withRestFallback,
    withRestFallbackSh,
} from "../lib/gh-rest-fallback";
import {
    fetchOpenIssueBodies,
    fetchRecentMergedPrs,
    fetchUnclaimedReadyQueue,
} from "../loop-status";
import { fetchClaimedIssues, fetchOpenPrBranches } from "../loop-doctor";

/**
 * The REST fallback for `loop:status`'s `gh` reads.
 *
 * Context (2026-09-07): with `graphql 0/5000` and `core 5000/5000`, every
 * `gh`-backed section of `loop:status` reported UNAVAILABLE at once even
 * though the REST pool was untouched. `gh issue list` / `gh pr list` are
 * GraphQL; the same questions over REST cost nothing from that pool.
 *
 * Two risks, and one test class each:
 *  - the translation answers a DIFFERENT question than the GraphQL query it
 *    stands in for (wrong labels, PRs counted as issues, a page that stops
 *    early) — covered by the projection/paging blocks;
 *  - the translator does not RECOGNISE the argv the real fetchers build, so
 *    the fallback silently never fires — covered by the "real argv" block,
 *    which drives the actual `fetchClaimedIssues` &c. rather than a
 *    hand-copied argv that can drift away from them.
 */

const REPO = "fil-donadoni/tolaria";
const RATE_LIMITED = new Error(
    "gh issue list failed: GraphQL: API rate limit already exceeded for user ID 117459688."
);

/** A runner that fails the GraphQL call the way a rate-limited `gh` does,
 *  then serves canned JSON to the REST retry — recording every argv it saw. */
function rateLimitedThen(restPages: unknown[][]) {
    const calls: string[][] = [];
    let page = 0;
    const runner = (args: string[]): string => {
        calls.push(args);
        if (args[0] !== "api") throw RATE_LIMITED;
        return JSON.stringify(restPages[page++] ?? []);
    };
    return { runner, calls };
}

/** REST rows carry `pull_request` on a PR and snake_case timestamps. */
function issueRow(over: Record<string, unknown> = {}) {
    return {
        number: 3100,
        title: "an issue",
        body: "## Blocked by\n- #3000",
        updated_at: "2026-09-07T09:00:00Z",
        labels: [{ name: "ready-for-agent" }],
        ...over,
    };
}

describe("gh-rest-fallback — when the fallback fires", () => {
    it("retries over REST only on a rate-limit failure", () => {
        expect(
            isRateLimitFailure("GraphQL: API rate limit already exceeded")
        ).toBe(true);
        expect(
            isRateLimitFailure("You have exceeded a secondary rate limit")
        ).toBe(true);
        expect(
            isRateLimitFailure(
                "GraphQL: Resource not accessible by personal access token"
            )
        ).toBe(false);
    });

    it("rethrows a non-rate-limit failure untouched, without calling REST", () => {
        const calls: string[][] = [];
        const base = (args: string[]): string => {
            calls.push(args);
            throw new Error("gh: not logged in");
        };
        const runner = withRestFallback(base, REPO);
        expect(() =>
            runner([
                "issue",
                "list",
                "--state",
                "open",
                "--json",
                "number,body",
            ])
        ).toThrow("not logged in");
        // Exactly one attempt: the GraphQL one. No REST retry.
        expect(calls).toHaveLength(1);
    });

    it("rethrows the ORIGINAL error when the query is not one it recognises", () => {
        const { runner, calls } = rateLimitedThen([]);
        const wrapped = withRestFallback(runner, REPO);
        // A `-label:` exclusion has no faithful REST equivalent — fail closed.
        expect(() =>
            wrapped([
                "issue",
                "list",
                "--search",
                "is:open -label:in-progress",
                "--json",
                "number,labels",
            ])
        ).toThrow("rate limit already exceeded");
        expect(calls.map((c) => c[0])).toEqual(["issue"]);
    });

    it("carries BOTH errors when the REST retry fails too", () => {
        const base = (args: string[]): string => {
            if (args[0] === "api") throw new Error("REST 403: also limited");
            throw RATE_LIMITED;
        };
        expect(() =>
            withRestFallback(
                base,
                REPO
            )([
                "issue",
                "list",
                "--state",
                "open",
                "--json",
                "number,body",
                "--limit",
                "100",
            ])
        ).toThrow(/rate limit already exceeded.*REST fallback.*also limited/s);
    });

    it("passes non-`gh` commands straight through — `git` has no quota", () => {
        const seen: string[] = [];
        const base = (cmd: string, args: string[]): string => {
            seen.push(`${cmd} ${args[0]}`);
            return "feat/issue-1";
        };
        expect(
            withRestFallbackSh(base, REPO)("git", [
                "branch",
                "--format=%(refname:short)",
            ])
        ).toBe("feat/issue-1");
        expect(seen).toEqual(["git branch"]);
    });
});

describe("gh-rest-fallback — the translation answers the same question", () => {
    it("drops pull requests from an issue read — REST `/issues` returns both", () => {
        const { runner } = rateLimitedThen([
            [
                issueRow({ number: 1 }),
                issueRow({ number: 2, pull_request: {} }),
            ],
        ]);
        const out = JSON.parse(
            withRestFallbackSh((_cmd, args) => runner(args), REPO)("gh", [
                "issue",
                "list",
                "--state",
                "open",
                "--json",
                "number,body",
                "--limit",
                "100",
            ])
        ) as { number: number }[];
        expect(out.map((r) => r.number)).toEqual([1]);
    });

    it("maps REST snake_case onto the GraphQL field names the callers parse", () => {
        const { runner, calls } = rateLimitedThen([
            [
                issueRow({
                    number: 42,
                    title: "t",
                    updated_at: "2026-09-07T08:00:00Z",
                }),
            ],
        ]);
        const out = JSON.parse(
            withRestFallback(
                runner,
                REPO
            )([
                "issue",
                "list",
                "--search",
                "is:open is:issue label:in-progress",
                "--json",
                "number,title,updatedAt",
                "--limit",
                "200",
            ])
        );
        expect(out).toEqual([
            { number: 42, title: "t", updatedAt: "2026-09-07T08:00:00Z" },
        ]);
        // The label from the `--search` qualifier reached the REST query.
        expect(calls[1]![1]).toContain("labels=in-progress");
        expect(calls[1]![1]).toContain("state=open");
    });

    it("keeps `merged_at: null` null — the caller's merged filter depends on it", () => {
        const { runner, calls } = rateLimitedThen([
            [
                {
                    number: 9,
                    title: "merged",
                    merged_at: "2026-09-07T08:00:00Z",
                    updated_at: "2026-09-07T08:00:00Z",
                },
                {
                    number: 10,
                    title: "closed unmerged",
                    merged_at: null,
                    updated_at: "2026-09-07T08:30:00Z",
                },
            ],
        ]);
        const out = JSON.parse(
            withRestFallback(
                runner,
                REPO
            )([
                "pr",
                "list",
                "--state",
                "merged",
                "--search",
                "sort:updated-desc",
                "--json",
                "number,title,mergedAt,updatedAt",
                "--limit",
                "100",
            ])
        ) as { number: number; mergedAt: string | null }[];
        expect(out.map((p) => p.mergedAt)).toEqual([
            "2026-09-07T08:00:00Z",
            null,
        ]);
        // REST has no `merged` state — it must ask for closed, newest first.
        expect(calls[1]![1]).toContain("state=closed");
        expect(calls[1]![1]).toContain("direction=desc");
    });

    it("pages until the caller's --limit, and stops on a short page", () => {
        const full = Array.from({ length: 100 }, (_, i) =>
            issueRow({ number: i + 1 })
        );
        const { runner, calls } = rateLimitedThen([
            full,
            [issueRow({ number: 999 })],
        ]);
        const out = JSON.parse(
            withRestFallback(
                runner,
                REPO
            )([
                "issue",
                "list",
                "--state",
                "open",
                "--json",
                "number,body",
                "--limit",
                "300",
            ])
        ) as unknown[];
        expect(out).toHaveLength(101);
        // Two REST pages, then stop — the second was short, so there is no
        // third even though `--limit 300` would have allowed one.
        const restCalls = calls.filter((c) => c[0] === "api");
        expect(restCalls).toHaveLength(2);
        expect(restCalls[0]![1]).toContain("page=1");
        expect(restCalls[1]![1]).toContain("page=2");
    });

    it("never returns more rows than --limit asked for", () => {
        const { runner } = rateLimitedThen([
            Array.from({ length: 100 }, (_, i) => issueRow({ number: i + 1 })),
        ]);
        const out = JSON.parse(
            withRestFallback(
                runner,
                REPO
            )([
                "issue",
                "list",
                "--state",
                "open",
                "--json",
                "number,body",
                "--limit",
                "5",
            ])
        ) as unknown[];
        expect(out).toHaveLength(5);
    });
});

describe("gh-rest-fallback — the REAL fetchers' argv is recognised", () => {
    /**
     * The failure this block exists for: the translator compiles, its own
     * unit tests pass on hand-written argv, and the fallback still never
     * fires in production because a fetcher builds its flags in a shape
     * `planRestFallback` returns `null` for. So drive the actual fetchers.
     */
    it("fetchClaimedIssues falls back", () => {
        const { runner } = rateLimitedThen([
            [issueRow({ number: 11, title: "claimed" })],
        ]);
        const out = fetchClaimedIssues(
            withRestFallbackSh((_cmd, args) => runner(args), REPO)
        );
        expect(out).toEqual([
            { number: 11, title: "claimed", updatedAt: "2026-09-07T09:00:00Z" },
        ]);
    });

    it("fetchOpenPrBranches falls back", () => {
        const { runner } = rateLimitedThen([
            [{ head: { ref: "feat/issue-3107" } }],
        ]);
        const out = fetchOpenPrBranches(
            withRestFallbackSh((_cmd, args) => runner(args), REPO)
        );
        expect([...out]).toEqual(["feat/issue-3107"]);
    });

    it("fetchUnclaimedReadyQueue falls back, and still drops in-progress", () => {
        const { runner } = rateLimitedThen([
            [
                issueRow({ number: 20 }),
                issueRow({
                    number: 21,
                    labels: [
                        { name: "ready-for-agent" },
                        { name: "in-progress" },
                    ],
                }),
            ],
        ]);
        const out = fetchUnclaimedReadyQueue(withRestFallback(runner, REPO));
        expect(out).toEqual([{ number: 20 }]);
    });

    it("fetchOpenIssueBodies falls back", () => {
        const { runner } = rateLimitedThen([
            [issueRow({ number: 30, body: "## Blocked by\n- #29" })],
        ]);
        const out = fetchOpenIssueBodies(withRestFallback(runner, REPO));
        expect(out).toEqual([{ number: 30, body: "## Blocked by\n- #29" }]);
    });

    it("fetchRecentMergedPrs falls back", () => {
        const now = new Date().toISOString();
        const { runner } = rateLimitedThen([
            [
                {
                    number: 3121,
                    title: "landed",
                    merged_at: now,
                    updated_at: now,
                },
            ],
        ]);
        const out = fetchRecentMergedPrs(24, withRestFallback(runner, REPO));
        expect(out.prs).toEqual([
            { number: 3121, title: "landed", mergedAt: now },
        ]);
    });
});
