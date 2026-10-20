// The console errors of one walk attempt (issue #6087): React logs a Convex
// `Server Error` through `%o`, so the Infra Verdict must read the RESOLVED
// argument, not the bare format string — else a dead deployment classifies as
// `unsettled`, the screen's word (the 2026-10-19 misattribution, issue #6081).
import { describe, expect, it } from "vitest";
import { createAttemptConsole } from "../ui-gate/attempt-console";
import { runCellAttempts } from "../ui-gate/cell-deadline";
import {
    classifyWalkFailure,
    UNSETTLED_MESSAGE_PREFIX,
    type RetryPolicy,
} from "../ui-gate/infra-verdict";

const SERVER_ERROR =
    "Error: [CONVEX Q(lobby:list)] [Request ID: 1a2b] Server Error";

/** A detail the test resolves by hand, after the event. */
function deferred(): {
    promise: Promise<string>;
    resolve: (value: string) => void;
} {
    let resolve!: (value: string) => void;
    const promise = new Promise<string>((r) => (resolve = r));
    return { promise, resolve };
}

const never = (): Promise<void> => new Promise<void>(() => {});
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("createAttemptConsole", () => {
    it("a `%o` error whose resolved argument is a Convex Server Error classifies the cell `deployment`", async () => {
        const collected = createAttemptConsole({
            detailWaitMs: 1_000,
            sleep: never,
        });
        collected.error("%o", Promise.resolve(`%o ${SERVER_ERROR}`));
        expect(
            classifyWalkFailure({
                message: `${UNSETTLED_MESSAGE_PREFIX} within 20000ms`,
                consoleErrors: await collected.lines(),
            })
        ).toEqual({ kind: "INFRA", signature: "deployment" });
    });

    it("waits for a detail still pending when the verdict is read", async () => {
        const collected = createAttemptConsole({
            detailWaitMs: 1_000,
            sleep: never,
        });
        const detail = deferred();
        collected.error("%o", detail.promise);
        const read = collected.lines();
        detail.resolve(SERVER_ERROR);
        expect(await read).toEqual(["%o", SERVER_ERROR]);
    });

    it("keeps the text once, when the detail adds nothing", async () => {
        const collected = createAttemptConsole({
            detailWaitMs: 1_000,
            sleep: never,
        });
        collected.error("plain", Promise.resolve("plain"));
        collected.uncaught("boom");
        expect(await collected.lines()).toEqual(["plain", "boom"]);
    });

    it("drops a detail that resolves after `clear()` — it belongs to the previous attempt", async () => {
        const collected = createAttemptConsole({
            detailWaitMs: 1_000,
            sleep: never,
        });
        const detail = deferred();
        collected.error("%o", detail.promise);
        collected.clear();
        detail.resolve(SERVER_ERROR);
        await tick();
        expect(await collected.lines()).toEqual([]);
    });

    it("a detail that never resolves (hung page) falls back to the text after the wait", async () => {
        const collected = createAttemptConsole({
            detailWaitMs: 5,
            sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        });
        collected.error("%o", new Promise<string>(() => {}));
        expect(await collected.lines()).toEqual(["%o"]);
    });

    it("a rejected detail falls back to the text", async () => {
        const collected = createAttemptConsole({
            detailWaitMs: 1_000,
            sleep: never,
        });
        collected.error("%o", Promise.reject(new Error("page closed")));
        expect(await collected.lines()).toEqual(["%o"]);
    });
});

describe("runCellAttempts reads the resolved console", () => {
    const POLICY: RetryPolicy = {
        maxAttempts: 1,
        loadThreshold: 8,
        pollMs: 5_000,
        maxWaitMs: 0,
    };

    it("an attempt that throws before its `%o` detail resolved is still `deployment`", async () => {
        const collected = createAttemptConsole({
            detailWaitMs: 1_000,
            sleep: never,
        });
        const detail = deferred();
        const outcome = await runCellAttempts<number>({
            attempt: async () => {
                collected.error("%o", detail.promise);
                // The detail lands only after the attempt has failed.
                setTimeout(() => detail.resolve(`%o ${SERVER_ERROR}`), 0);
                throw new Error(`${UNSETTLED_MESSAGE_PREFIX} within 20000ms`);
            },
            attemptConsole: () => collected.lines(),
            reasonOf: (err) => (err as Error).message,
            onDeadline: () => {},
            beforeRetry: async () => {},
            note: () => {},
            deadlineMs: 1_000,
            policy: POLICY,
            loadAverage: () => 20,
            sleep: async () => {},
            where: "lobby @ phone",
        });
        expect(outcome).toMatchObject({
            kind: "INFRA",
            signature: "deployment",
        });
    });
});
