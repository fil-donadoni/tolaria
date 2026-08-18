import { describe, it, expect, vi } from "vitest";
import { fetchBoardPriority } from "../lib/board-priority";

/**
 * `lib/board-priority.ts` (#2519) — extracted out of `queue-plan.ts` so
 * `loop:status` can read the SAME board query without a second, drifting
 * implementation. The failure policy (`onError`) is the one thing that had
 * to become a parameter: `queue:plan` needs the read to FAIL LOUD (a
 * mis-ordered batch is worse than a stopped loop); `loop:status` needs it to
 * degrade gracefully (a missing priority column is cosmetic there). Every
 * test drives `ghClient` by hand — no real `gh` call.
 */

const OWNER = "fil-donadoni";
const PROJECT_NUMBER = "2";
const REPO = "fil-donadoni/tolaria";

function itemList(
    items: { number: number; repo?: string; priority?: string; type?: string }[]
): string {
    return JSON.stringify({
        items: items.map((i) => ({
            content: {
                type: i.type ?? "Issue",
                number: i.number,
                repository: i.repo ?? REPO,
            },
            ...(i.priority === undefined ? {} : { priority: i.priority }),
        })),
    });
}

function projectView(totalCount: number): string {
    return JSON.stringify({ items: { totalCount } });
}

describe("board-priority — fetchBoardPriority", () => {
    it("maps issue number to priority for matching Issue rows in the configured repo", () => {
        const calls: string[][] = [];
        const priority = fetchBoardPriority({
            owner: OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: REPO,
            itemLimit: 100,
            onError: () => {
                throw new Error("should not be called");
            },
            ghClient: (args) => {
                calls.push(args);
                return args[1] === "item-list"
                    ? itemList([
                          { number: 1, priority: "P0" },
                          { number: 2, priority: "P2" },
                      ])
                    : projectView(2);
            },
        });
        expect(priority).toEqual({ 1: "P0", 2: "P2" });
        expect(calls[0]![1]).toBe("item-list");
    });

    it("skips a row from a DIFFERENT repo — issue numbers are unique per repo, not per board", () => {
        const priority = fetchBoardPriority({
            owner: OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: REPO,
            itemLimit: 100,
            onError: () => {},
            ghClient: (args) =>
                args[1] === "item-list"
                    ? itemList([
                          { number: 1, priority: "P0", repo: "someone/else" },
                      ])
                    : projectView(1),
        });
        expect(priority).toEqual({});
    });

    it("skips a non-Issue row (a draft or a PR on the board)", () => {
        const priority = fetchBoardPriority({
            owner: OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: REPO,
            itemLimit: 100,
            onError: () => {},
            ghClient: (args) =>
                args[1] === "item-list"
                    ? itemList([
                          { number: 1, priority: "P0", type: "PullRequest" },
                      ])
                    : projectView(1),
        });
        expect(priority).toEqual({});
    });

    it("skips an item with no Priority set, without invoking onError", () => {
        let errored = false;
        const priority = fetchBoardPriority({
            owner: OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: REPO,
            itemLimit: 100,
            onError: () => {
                errored = true;
            },
            ghClient: (args) =>
                args[1] === "item-list"
                    ? itemList([{ number: 1 }])
                    : projectView(1),
        });
        expect(priority).toEqual({});
        expect(errored).toBe(false);
    });

    it("calls onError and returns {} when the item-list read throws (e.g. a missing scope)", () => {
        const messages: string[] = [];
        const priority = fetchBoardPriority({
            owner: OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: REPO,
            itemLimit: 100,
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

    it("calls onError and skips just the one item on an unrecognized priority value, rather than aborting the whole read", () => {
        const messages: string[] = [];
        const priority = fetchBoardPriority({
            owner: OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: REPO,
            itemLimit: 100,
            onError: (m) => messages.push(m),
            ghClient: (args) =>
                args[1] === "item-list"
                    ? itemList([
                          { number: 1, priority: "P0" },
                          { number: 2, priority: "P9" },
                      ])
                    : projectView(2),
        });
        // #1 still comes through — a bad value on #2 must not blank the map.
        expect(priority).toEqual({ 1: "P0" });
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatch(/issue #2/);
    });

    it("calls onError and returns {} when item-list is truncated against totalCount", () => {
        const messages: string[] = [];
        const priority = fetchBoardPriority({
            owner: OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: REPO,
            itemLimit: 100,
            onError: (m) => messages.push(m),
            ghClient: (args) =>
                args[1] === "item-list"
                    ? itemList([{ number: 1, priority: "P0" }])
                    : projectView(5),
        });
        expect(priority).toEqual({});
        expect(messages[0]).toMatch(/truncated/);
    });

    it("skip:true warns directly and returns {} WITHOUT calling onError, and makes no gh call (PR #2545 review, finding 1)", () => {
        // Before the fix, the skip branch routed its message through
        // `opts.onError` — which is exactly the callback `queue:plan` wires
        // to `die()`. That made `queue:plan --no-priority` (the documented
        // escape hatch for a board that cannot be read) call `die()` on its
        // OWN deliberate skip and exit(2), deleting the escape hatch. The
        // fix: the skip is not an error, so it must never reach `onError` —
        // it warns on its own and `onError` stays reserved for genuine
        // failures (bad scope, truncated list, unrecognized priority value).
        let onErrorCalled = false;
        let ghCalled = false;
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const priority = fetchBoardPriority({
            owner: OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: REPO,
            itemLimit: 100,
            skip: true,
            onError: () => {
                onErrorCalled = true;
            },
            ghClient: () => {
                ghCalled = true;
                return "{}";
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
            itemLimit: 100,
            skip: true,
            onError: (m) => {
                throw new Error(`die: ${m}`);
            },
            ghClient: () => "{}",
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
                itemLimit: 100,
                onError: (m) => {
                    throw new Error(`die: ${m}`);
                },
                ghClient: (args) =>
                    args[1] === "item-list"
                        ? itemList([{ number: 1, priority: "P9" }])
                        : projectView(1),
            })
        ).toThrow(/die: issue #1/);
    });
});
