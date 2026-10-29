import { afterEach, describe, it, expect } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    GH_READ_TIMEOUT_MS,
    GH_RETRY_BACKOFF_MS,
    GH_WRITE_TIMEOUT_MS,
    type GhRetryState,
    ghTimeoutMs,
    isReadOnlyGh,
    isTimeoutError,
    isTransientGhError,
    runGh,
    withGhRetry,
} from "../lib/gh";

/**
 * `gh()` replays a READ that met a transient GitHub 5xx (issue #5540): one
 * `HTTP 504` on the queue read stopped a whole AFK run at pre-flight.
 * A write is never replayed — a 504 on a write may have landed.
 */

const GATEWAY_504 = Object.assign(
    new Error(
        "Command failed: gh issue list --label ready-for-agent\nHTTP 504: 504 Gateway Timeout (https://api.github.com/graphql)\n"
    ),
    {
        stderr: "HTTP 504: 504 Gateway Timeout (https://api.github.com/graphql)\n",
    }
);
const NOT_FOUND = Object.assign(new Error("Command failed: gh issue view 1"), {
    stderr: "GraphQL: Could not resolve to an issue (repository.issue)\n",
});

const QUEUE_READ = [
    "issue",
    "list",
    "--label",
    "ready-for-agent",
    "--state",
    "open",
    "--json",
    "number",
    "--limit",
    "600",
];

const fresh = (): GhRetryState => ({ outage: false });

/** A `run` that fails with each queued error in turn, then answers "ok". */
function flaky(errors: unknown[]) {
    let calls = 0;
    return {
        run: () => {
            calls++;
            const err = errors.shift();
            if (err !== undefined) throw err;
            return "ok";
        },
        calls: () => calls,
    };
}

describe("isTransientGhError", () => {
    it("recognises the 504 that stopped an AFK run, and 502/503", () => {
        expect(isTransientGhError(GATEWAY_504)).toBe(true);
        expect(isTransientGhError(new Error("HTTP 502: Bad Gateway"))).toBe(
            true
        );
        expect(
            isTransientGhError(new Error("HTTP 503: Service Unavailable"))
        ).toBe(true);
    });

    it("reads stderr, not the argv echoed into the message", () => {
        const searchEcho = Object.assign(
            new Error('Command failed: gh search issues "Bad Gateway"'),
            { stderr: "HTTP 404: Not Found\n" }
        );
        expect(isTransientGhError(searchEcho)).toBe(false);
    });

    it("leaves 4xx, rate limits and not-found alone", () => {
        expect(isTransientGhError(NOT_FOUND)).toBe(false);
        expect(isTransientGhError(new Error("HTTP 404: Not Found"))).toBe(
            false
        );
        expect(
            isTransientGhError(
                new Error("GraphQL: API rate limit already exceeded")
            )
        ).toBe(false);
        expect(isTransientGhError(new Error("HTTP 500: Internal"))).toBe(false);
    });
});

describe("isReadOnlyGh", () => {
    it.each([
        [QUEUE_READ],
        [["issue", "view", "12", "--json", "parent"]],
        [["pr", "list", "--state", "open"]],
        [["search", "issues", "foo"]],
        [["project", "item-list", "2", "--owner", "x"]],
        [
            [
                "api",
                "--paginate",
                "repos/{owner}/{repo}/issues/1/dependencies/blocked_by",
            ],
        ],
        [["api", "-X", "GET", "search/issues", "-f", "q=x"]],
        [["api", "graphql", "-f", "query={ viewer { login } }"]],
    ])("reads: gh %j", (args) => {
        expect(isReadOnlyGh(args)).toBe(true);
    });

    it.each([
        [["issue", "create", "--title", "t"]],
        [["issue", "edit", "12", "--parent", "3"]],
        [["issue", "comment", "12", "--body", "x"]],
        [["pr", "merge", "12"]],
        [["project", "item-edit", "--id", "x"]],
        [["api", "repos/{owner}/{repo}/issues", "-f", "title=x"]],
        [["api", "-X", "DELETE", "repos/{owner}/{repo}/labels/x"]],
        [["api", "--method=PATCH", "repos/{owner}/{repo}/issues/1"]],
        [["api", "graphql", "-f", "query=mutation { removeSubIssue }"]],
        [["api", "graphql", "-f", "query=# note\nmutation { x }"]],
        [["api", "graphql", "--field=query=mutation { x }"]],
        [["api", "graphql", "-fquery=mutation { x }"]],
        [["api", "graphql", "--input", "body.json"]],
        [
            [
                "api",
                "graphql",
                "--input",
                "b.json",
                "-f",
                "query={ viewer { login } }",
            ],
        ],
        [["api", "graphql", "-F", "query=@q.graphql"]],
        [["api", "graphql"]],
        [["api", "-XDELETE", "repos/{owner}/{repo}/labels/x"]],
        [["api", "-X=POST", "repos/{owner}/{repo}/issues"]],
        [["api", "repos/{owner}/{repo}/issues", "-ftitle=x"]],
        [["api", "repos/{owner}/{repo}/issues", "--input", "-"]],
        [["auth", "status"]],
        [[]],
    ])("writes or unknown: gh %j", (args) => {
        expect(isReadOnlyGh(args)).toBe(false);
    });
});

describe("withGhRetry", () => {
    it("replays a read through transient 504s and returns the first success", () => {
        const slept: number[] = [];
        const f = flaky([GATEWAY_504, GATEWAY_504]);
        expect(
            withGhRetry(
                QUEUE_READ,
                f.run,
                (ms) => slept.push(ms),
                GH_RETRY_BACKOFF_MS,
                fresh()
            )
        ).toBe("ok");
        expect(f.calls()).toBe(3);
        expect(slept).toEqual(GH_RETRY_BACKOFF_MS.slice(0, 2));
    });

    it("is bounded: rethrows the last 504 once the backoff is spent", () => {
        const slept: number[] = [];
        const f = flaky(Array(10).fill(GATEWAY_504));
        expect(() =>
            withGhRetry(
                QUEUE_READ,
                f.run,
                (ms) => slept.push(ms),
                GH_RETRY_BACKOFF_MS,
                fresh()
            )
        ).toThrow(GATEWAY_504);
        expect(f.calls()).toBe(GH_RETRY_BACKOFF_MS.length + 1);
        expect(slept.reduce((a, b) => a + b, 0)).toBeLessThan(60_000);
    });

    it("never replays a write, even on a 504", () => {
        const f = flaky([GATEWAY_504]);
        expect(() =>
            withGhRetry(
                ["issue", "create", "--title", "t"],
                f.run,
                () => {
                    throw new Error("must not sleep");
                },
                GH_RETRY_BACKOFF_MS,
                fresh()
            )
        ).toThrow(GATEWAY_504);
        expect(f.calls()).toBe(1);
    });

    it("throws a non-transient error on the first attempt", () => {
        const f = flaky([NOT_FOUND]);
        expect(() =>
            withGhRetry(
                QUEUE_READ,
                f.run,
                () => {
                    throw new Error("must not sleep");
                },
                GH_RETRY_BACKOFF_MS,
                fresh()
            )
        ).toThrow(NOT_FOUND);
        expect(f.calls()).toBe(1);
    });

    it("an exhausted call trips the outage: the next read fails fast, a success resets it", () => {
        const state = fresh();
        const slept: number[] = [];
        const down = flaky(Array(10).fill(GATEWAY_504));
        expect(() =>
            withGhRetry(
                QUEUE_READ,
                down.run,
                (ms) => slept.push(ms),
                GH_RETRY_BACKOFF_MS,
                state
            )
        ).toThrow(GATEWAY_504);
        expect(state.outage).toBe(true);

        const next = flaky([GATEWAY_504]);
        expect(() =>
            withGhRetry(
                QUEUE_READ,
                next.run,
                () => {
                    throw new Error("must not sleep");
                },
                GH_RETRY_BACKOFF_MS,
                state
            )
        ).toThrow(GATEWAY_504);
        expect(next.calls()).toBe(1);

        expect(
            withGhRetry(
                QUEUE_READ,
                () => "ok",
                () => {},
                GH_RETRY_BACKOFF_MS,
                state
            )
        ).toBe("ok");
        expect(state.outage).toBe(false);
    });
});

// ── every call has a deadline (issue #5933) ──────────────────────────────────

/** What `execFileSync` throws when its `timeout` expires. */
const TIMED_OUT = Object.assign(new Error("spawnSync gh ETIMEDOUT"), {
    code: "ETIMEDOUT",
    signal: "SIGKILL",
});

describe("gh deadlines — a hung call is a failure, never a stall (issue #5933)", () => {
    it("a read gets the read deadline, a write the longer write deadline", () => {
        expect(ghTimeoutMs(QUEUE_READ)).toBe(GH_READ_TIMEOUT_MS);
        expect(ghTimeoutMs(["issue", "create", "--title", "t"])).toBe(
            GH_WRITE_TIMEOUT_MS
        );
        expect(GH_WRITE_TIMEOUT_MS).toBeGreaterThan(GH_READ_TIMEOUT_MS);
    });

    it("a missed deadline is a timeout, and transient", () => {
        expect(isTimeoutError(TIMED_OUT)).toBe(true);
        expect(isTimeoutError(NOT_FOUND)).toBe(false);
        expect(isTransientGhError(TIMED_OUT)).toBe(true);
    });

    it("a read that missed its deadline is replayed; a write never is — it may have landed", () => {
        const read = flaky([TIMED_OUT]);
        expect(
            withGhRetry(
                QUEUE_READ,
                read.run,
                () => {},
                GH_RETRY_BACKOFF_MS,
                fresh()
            )
        ).toBe("ok");
        expect(read.calls()).toBe(2);

        const write = flaky([TIMED_OUT]);
        expect(() =>
            withGhRetry(
                ["issue", "edit", "1", "--body", "b"],
                write.run,
                () => {
                    throw new Error("must not sleep");
                },
                GH_RETRY_BACKOFF_MS,
                fresh()
            )
        ).toThrow(TIMED_OUT);
        expect(write.calls()).toBe(1);
    });

    describe("runGh kills a gh that never answers", () => {
        const savedPath = process.env.PATH;
        const dirs: string[] = [];
        afterEach(() => {
            process.env.PATH = savedPath;
            for (const d of dirs.splice(0))
                rmSync(d, {
                    recursive: true,
                    force: true,
                    maxRetries: 10,
                    retryDelay: 100,
                });
        });

        it("throws ETIMEDOUT at its deadline — the hung gh would otherwise exit 0 after 30 s", () => {
            const bin = mkdtempSync(join(tmpdir(), "gh-hang-"));
            dirs.push(bin);
            writeFileSync(join(bin, "gh"), "#!/bin/sh\nexec sleep 30\n");
            chmodSync(join(bin, "gh"), 0o755);
            process.env.PATH = `${bin}:${savedPath}`;
            let caught: unknown;
            try {
                runGh(["issue", "view", "1"], 300);
            } catch (err) {
                caught = err;
            }
            expect(isTimeoutError(caught)).toBe(true);
        });
    });
});
