import { describe, it, expect, vi } from "vitest";
import {
    computeItemLimit,
    fetchBoardPriority,
    isPossiblyTruncated,
} from "../lib/board-priority";

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
        // `project view` comes FIRST and its `totalCount` sizes the item-list
        // window (issue #2520) — a static `--limit 2000` on a 411-item board
        // pages far past the end, and every page is a GraphQL round trip on a
        // budget several sessions share.
        expect(calls[0]![1]).toBe("view");
        expect(calls[1]![1]).toBe("item-list");
        expect(calls[1]![calls[1]!.indexOf("--limit") + 1]).toBe(
            String(computeItemLimit(2, 100))
        );
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
            ghClient: (args) => {
                if (args[1] === "view") return projectView(1);
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

    it("calls onError and returns {} when the response FILLED the sized window — the board may have grown past it", () => {
        // Corrected polarity (issue #2520). This used to compare
        // `items.length < totalCount`, which can only fire when the board
        // SHRANK between the two calls — harmless — and is structurally
        // unable to fire when it GREW, which is the case that silently drops
        // the oldest items (a P0 among them) because `gh` returns the NEWEST
        // `limit` items, never the first `limit`.
        const messages: string[] = [];
        const limit = computeItemLimit(5, 100);
        const priority = fetchBoardPriority({
            owner: OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: REPO,
            itemLimit: 100,
            onError: (m) => messages.push(m),
            ghClient: (args) =>
                args[1] === "item-list"
                    ? itemList(
                          Array.from({ length: limit }, (_, i) => ({
                              number: i + 1,
                              priority: "P0",
                          }))
                      )
                    : projectView(5),
        });
        expect(priority).toEqual({});
        expect(messages[0]).toMatch(/truncated/);
        expect(messages[0]).toMatch(new RegExp(`sized limit \\(${limit}\\)`));
    });

    it("does NOT call onError when the board SHRANK below the sized window — nothing was lost", () => {
        // The spurious stop the old `items.length < totalCount` check
        // produced: `project view` reported 5, the board dropped to 2 before
        // `item-list` ran, and the read hard-stopped with a "the board likely
        // grew" message even though it had seen everything.
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
                          { number: 2, priority: "P1" },
                      ])
                    : projectView(5),
        });
        expect(priority).toEqual({ 1: "P0", 2: "P1" });
        expect(messages).toEqual([]);
    });

    it("falls back to the caller's itemLimit only when totalCount is unreadable", () => {
        const calls: string[][] = [];
        fetchBoardPriority({
            owner: OWNER,
            projectNumber: PROJECT_NUMBER,
            repo: REPO,
            itemLimit: 100,
            onError: () => {},
            ghClient: (args) => {
                calls.push(args);
                return args[1] === "item-list"
                    ? itemList([{ number: 1, priority: "P0" }])
                    : JSON.stringify({ items: {} });
            },
        });
        const itemListCall = calls.find((c) => c[1] === "item-list")!;
        expect(itemListCall[itemListCall.indexOf("--limit") + 1]).toBe("100");
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

describe("board priority — computeItemLimit (issue #2520 round 2)", () => {
    it("sizes the request to the board's own totalCount PLUS headroom, not exactly totalCount", () => {
        // Round 1 pinned this to exactly 411 — `gh project item-list --limit N`
        // returns the N NEWEST items, not the first N, so sizing the limit to
        // exactly `totalCount` means a board that grows between the `project
        // view` (totalCount) call and the `item-list` call gets its OLDEST
        // items silently dropped. A lower bound is the correct assertion: it
        // is still much smaller than the historical static 2000, but leaves
        // room to absorb ordinary growth in that gap.
        const limit = computeItemLimit(411, 2000);
        expect(limit).toBeGreaterThan(411);
        expect(limit).toBeLessThan(2000);
    });

    it("falls back only when totalCount is unreadable", () => {
        expect(computeItemLimit(undefined, 2000)).toBe(2000);
        expect(computeItemLimit(0, 2000)).toBe(2000);
        expect(computeItemLimit(Number.NaN, 2000)).toBe(2000);
    });
});

describe("board priority — isPossiblyTruncated (issue #2520 round 2)", () => {
    it("fires when the response FILLED the sized window — the board may have grown past it", () => {
        // The polarity this test locks in: `project view` reports 411,
        // `computeItemLimit` sizes the window to 461 (411 + headroom), but the
        // board grows to 470 items before `item-list` runs. `gh` returns the
        // 461 NEWEST items — the window is exactly filled — so the read
        // cannot prove the two OLDEST items (one of which can carry a P0)
        // weren't dropped. The OLD check (`items.length < expected`, i.e.
        // `461 < 411`) was false here: no die(), priorities silently lost.
        const limit = computeItemLimit(411, 2000);
        expect(isPossiblyTruncated(limit, limit)).toBe(true);
    });

    it("does NOT fire when the board shrank — nothing was lost", () => {
        // `project view` reports 411 (limit sized to 461), the board shrinks
        // to 409 items before `item-list` runs: `items.length` (409) is
        // strictly under the limit (461), which proves the read saw
        // everything. The OLD check (`409 < 411`) fired here and hard-stopped
        // with a misleading "the board likely grew" message even though
        // nothing was lost — a spurious stop in the harmless direction.
        const limit = computeItemLimit(411, 2000);
        expect(isPossiblyTruncated(409, limit)).toBe(false);
    });

    it("does not fire on a response strictly under the limit", () => {
        expect(isPossiblyTruncated(460, 461)).toBe(false);
    });
});
