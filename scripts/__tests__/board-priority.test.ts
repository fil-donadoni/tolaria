import { describe, it, expect, vi } from "vitest";
import { fetchBoardPriority, isTruncated } from "../lib/board-priority";

/**
 * `lib/board-priority.ts` (#2519) — extracted out of `queue-plan.ts` so
 * `loop:status` can read the SAME board query without a second, drifting
 * implementation. The failure policy (`onError`) is the one thing that had
 * to become a parameter: `queue:plan` needs the read to FAIL LOUD (a
 * mis-ordered batch is worse than a stopped loop); `loop:status` needs it to
 * degrade gracefully (a missing priority column is cosmetic there). Every
 * test drives `ghClient` by hand — no real `gh` call.
 *
 * The read is a raw `gh api graphql --paginate --slurp` query for the
 * `Priority` field alone, not `gh project item-list`, which asks for every
 * field value of every item: 766 GraphQL points against this board versus 8
 * — same 351 entries, same values — on a 5000-point/HOUR pool shared by
 * every session on the machine (measured 2026-09-07). Two of these tests
 * exist specifically because that substitution has failure modes
 * `item-list` did not:
 *  - gh's `--paginate` contract is keyed to a variable named exactly
 *    `$endCursor`; get it wrong and the read silently returns page ONE, so
 *    the pagination test drives two pages and asserts both are merged;
 *  - a non-resolving owner or project number comes back as `null` DATA with
 *    a ZERO exit, so it never reaches the `catch` — an empty map there would
 *    render as "nobody prioritised anything" and the queue would sort on it.
 */

const OWNER = "fil-donadoni";
const PROJECT_NUMBER = "2";
const REPO = "fil-donadoni/tolaria";

interface FakeItem {
    number: number;
    repo?: string;
    priority?: string;
    typename?: string;
}

function node(item: FakeItem) {
    return {
        content: {
            __typename: item.typename ?? "Issue",
            number: item.number,
            repository: { nameWithOwner: item.repo ?? REPO },
        },
        // `null`, not an absent key: that is what GitHub sends for an item
        // with no Priority set.
        fieldValueByName:
            item.priority === undefined ? null : { name: item.priority },
    };
}

function page(
    items: FakeItem[],
    opts: { hasNextPage?: boolean; totalCount?: number } = {}
) {
    return {
        data: {
            repositoryOwner: {
                projectV2: {
                    items: {
                        totalCount: opts.totalCount ?? items.length,
                        pageInfo: {
                            hasNextPage: opts.hasNextPage ?? false,
                            endCursor: "cursor",
                        },
                        nodes: items.map(node),
                    },
                },
            },
        },
    };
}

/** What `--slurp` hands back: one JSON array holding every page response. */
function slurped(...pages: unknown[]): string {
    return JSON.stringify(pages);
}

function neverErrors(): (m: string) => void {
    return () => {
        throw new Error("onError should not be called");
    };
}

describe("board-priority — fetchBoardPriority", () => {
    it("maps issue number to priority, over ONE paginated GraphQL call", () => {
        const calls: string[][] = [];
        const priority = fetchBoardPriority({
            owner: OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: REPO,
            onError: neverErrors(),
            ghClient: (args) => {
                calls.push(args);
                return slurped(
                    page([
                        { number: 1, priority: "P0" },
                        { number: 2, priority: "P2" },
                    ])
                );
            },
        });
        expect(priority).toEqual({ 1: "P0", 2: "P2" });

        // ONE call. The `gh project view` that used to precede the read —
        // purely to size an `item-list --limit` window — is gone with the
        // window, and with it the owner-type lookup that reported a
        // rate-limited board as `unknown owner type`.
        expect(calls).toHaveLength(1);
        const args = calls[0]!;
        expect(args.slice(0, 2)).toEqual(["api", "graphql"]);
        expect(args).toContain("--paginate");
        expect(args).toContain("--slurp");
        // `-F`, not `-f`: `$number: Int!` rejects a string outright.
        expect(args[args.indexOf("-F") + 1]).toBe(`owner=${OWNER}`);
        expect(args).toContain(`number=${PROJECT_NUMBER}`);
        const query = args[args.indexOf("-f") + 1]!;
        expect(query).toContain('fieldValueByName(name: "Priority")');
        // The whole point of the rewrite: ask for the Priority field, not
        // every field value of every item.
        expect(query).not.toContain("fieldValues");
    });

    it("merges EVERY page — the --paginate contract is a variable named $endCursor", () => {
        // gh feeds `pageInfo.endCursor` back into a variable of that exact
        // name. Rename it and gh returns page one and stops: the newest 100
        // items keep their priorities and every older one silently loses
        // them, with no error anywhere. This is the test that notices.
        const priority = fetchBoardPriority({
            owner: OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: REPO,
            onError: neverErrors(),
            ghClient: (args) => {
                expect(args[args.indexOf("-f") + 1]).toContain(
                    "$endCursor: String"
                );
                return slurped(
                    page([{ number: 1, priority: "P0" }], {
                        hasNextPage: true,
                        totalCount: 2,
                    }),
                    page([{ number: 2, priority: "P1" }], { totalCount: 2 })
                );
            },
        });
        expect(priority).toEqual({ 1: "P0", 2: "P1" });
    });

    it("skips a row from a DIFFERENT repo — issue numbers are unique per repo, not per board", () => {
        const priority = fetchBoardPriority({
            owner: OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: REPO,
            onError: () => {},
            ghClient: () =>
                slurped(
                    page([{ number: 1, priority: "P0", repo: "someone/else" }])
                ),
        });
        expect(priority).toEqual({});
    });

    it("skips a non-Issue row (a draft or a PR on the board)", () => {
        const priority = fetchBoardPriority({
            owner: OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: REPO,
            onError: () => {},
            ghClient: () =>
                slurped(
                    page([
                        { number: 1, priority: "P0", typename: "PullRequest" },
                    ])
                ),
        });
        expect(priority).toEqual({});
    });

    it("skips an item with no Priority set, without invoking onError", () => {
        let errored = false;
        const priority = fetchBoardPriority({
            owner: OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: REPO,
            onError: () => {
                errored = true;
            },
            ghClient: () => slurped(page([{ number: 1 }])),
        });
        expect(priority).toEqual({});
        expect(errored).toBe(false);
    });

    it("calls onError and returns {} when the read throws (e.g. a missing scope)", () => {
        const messages: string[] = [];
        const priority = fetchBoardPriority({
            owner: OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: REPO,
            onError: (m) => messages.push(m),
            ghClient: () => {
                throw new Error(
                    "GraphQL: Resource not accessible (read:project)"
                );
            },
        });
        expect(priority).toEqual({});
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatch(/cannot read project/);
    });

    it("calls onError when the owner or project does not resolve — null data exits ZERO", () => {
        // The failure `item-list` did not have. `repositoryOwner: null` (a
        // typo'd owner, a project number that is not theirs, a `Priority`
        // field that was renamed) is a successful HTTP call with null data:
        // the `catch` never fires, and returning `{}` here would read as
        // "nobody prioritised anything" — a wrong queue order presented as a
        // real one.
        const messages: string[] = [];
        const priority = fetchBoardPriority({
            owner: OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: REPO,
            onError: (m) => messages.push(m),
            ghClient: () => slurped({ data: { repositoryOwner: null } }),
        });
        expect(priority).toEqual({});
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatch(/does not resolve/);
    });

    it("calls onError when --slurp returns no pages at all", () => {
        const messages: string[] = [];
        const priority = fetchBoardPriority({
            owner: OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: REPO,
            onError: (m) => messages.push(m),
            ghClient: () => "[]",
        });
        expect(priority).toEqual({});
        expect(messages[0]).toMatch(/no pages/);
    });

    it("calls onError and returns {} when pagination stopped with pages outstanding", () => {
        // A partial board must never be treated as the whole one — the items
        // pagination has not reached are the OLDEST, and one of them can
        // carry a P0 (issue #2520's harm, in its cursor-paginated form).
        const messages: string[] = [];
        const priority = fetchBoardPriority({
            owner: OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: REPO,
            onError: (m) => messages.push(m),
            ghClient: () =>
                slurped(
                    page([{ number: 1, priority: "P0" }], {
                        hasNextPage: true,
                        totalCount: 400,
                    })
                ),
        });
        expect(priority).toEqual({});
        expect(messages[0]).toMatch(/stopped after 1 of 400 items/);
    });

    it("calls onError and skips just the one item on an unrecognized priority value, rather than aborting the whole read", () => {
        const messages: string[] = [];
        const priority = fetchBoardPriority({
            owner: OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: REPO,
            onError: (m) => messages.push(m),
            ghClient: () =>
                slurped(
                    page([
                        { number: 1, priority: "P0" },
                        { number: 2, priority: "P9" },
                    ])
                ),
        });
        // #1 still comes through — a bad value on #2 must not blank the map.
        expect(priority).toEqual({ 1: "P0" });
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatch(/issue #2/);
    });

    it("skip:true warns directly and returns {} WITHOUT calling onError, and makes no gh call (PR #2545 review, finding 1)", () => {
        // Before the fix, the skip branch routed its message through
        // `opts.onError` — which is exactly the callback `queue:plan` wires
        // to `die()`. That made `queue:plan --no-priority` (the documented
        // escape hatch for a board that cannot be read) call `die()` on its
        // OWN deliberate skip and exit(2), deleting the escape hatch. The
        // fix: the skip is not an error, so it must never reach `onError` —
        // it warns on its own and `onError` stays reserved for genuine
        // failures (bad scope, truncated read, unrecognized priority value).
        let onErrorCalled = false;
        let ghCalled = false;
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const priority = fetchBoardPriority({
            owner: OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: REPO,
            skip: true,
            onError: () => {
                onErrorCalled = true;
            },
            ghClient: () => {
                ghCalled = true;
                return "[]";
            },
        });
        expect(priority).toEqual({});
        expect(ghCalled).toBe(false);
        expect(onErrorCalled).toBe(false);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0]?.[0]).toMatch(/--no-priority/);
        warnSpy.mockRestore();
    });

    it("skip:true with a DIE-style onError does not abort — the escape hatch survives queue:plan's own fail-loud policy", () => {
        // The regression this guards: `queue:plan` passes `die` (never
        // returns, calls `process.exit`) as `onError`. If the skip branch
        // ever called `onError` again, this test would throw/exit instead of
        // returning `{}`.
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const priority = fetchBoardPriority({
            owner: OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: REPO,
            skip: true,
            onError: (m) => {
                throw new Error(`die: ${m}`);
            },
            ghClient: () => "[]",
        });
        expect(priority).toEqual({});
        warnSpy.mockRestore();
    });

    it("lets a DIE-style onError (never returns) abort before any item is skipped — queue:plan's own policy", () => {
        // This is the shape queue:plan relies on: onError = die, which calls
        // process.exit and never returns, so nothing after the FIRST bad item
        // runs. Simulated here with a throw, since a real process.exit()
        // would kill the test runner.
        expect(() =>
            fetchBoardPriority({
                owner: OWNER,
                projectNumber: PROJECT_NUMBER,
                repo: REPO,
                onError: (m) => {
                    throw new Error(`die: ${m}`);
                },
                ghClient: () => slurped(page([{ number: 1, priority: "P9" }])),
            })
        ).toThrow(/die: issue #1/);
    });
});

describe("board priority — isTruncated", () => {
    it("fires when the LAST page still reports another page", () => {
        expect(
            isTruncated([
                page([{ number: 1 }], { hasNextPage: false }),
                page([{ number: 2 }], { hasNextPage: true }),
            ])
        ).toBe(true);
    });

    it("does not fire when the last page completed the walk", () => {
        // Only the LAST page matters: every page before it necessarily said
        // `hasNextPage: true`, which is what made gh fetch the next one.
        expect(
            isTruncated([
                page([{ number: 1 }], { hasNextPage: true }),
                page([{ number: 2 }], { hasNextPage: false }),
            ])
        ).toBe(false);
    });

    it("does not fire on an empty page list — that is the no-pages error, not truncation", () => {
        expect(isTruncated([])).toBe(false);
    });
});
