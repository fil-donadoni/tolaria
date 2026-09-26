// The Infra Verdict's pure half (issue #3644, CONTEXT.md § Surfaces): a failed
// walk attempt is classified by its signature, retried on a schedule that is a
// function of the attempt count and the load samples, and stands as INFRA only
// while the machine is still busy — UNWALKED keeps meaning "the walk could not
// reach the surface on a quiet machine".
import { describe, expect, it } from "vitest";
import {
    UNSETTLED_MESSAGE_PREFIX,
    classifyWalkFailure,
    infraDetail,
    retryStep,
    standingVerdict,
    type RetryPolicy,
} from "../ui-gate/infra-verdict";

/** Console lines and messages in the shapes the lane actually captures. */
const CONVEX_TIMEOUT_CONSOLE =
    "[CONVEX Q(lobby:listOpenTables)] [Request ID: 5c3f0a] Server Error\nUncaught Error: Function execution timed out (maximum duration: 1s)";
const CONVEX_SERVER_ERROR_CONSOLE =
    "[CONVEX M(game:passPriority)] [Request ID: 91be27] Server Error\nCalled by client";
const GOTO_TIMEOUT =
    'page.goto: Timeout 20000ms exceeded.\nCall log:\n  - navigating to "http://127.0.0.1:5173/", waiting until "domcontentloaded"';
const CLICK_TIMEOUT =
    '`[data-debug-sheet-toggle]` was visible but could not be clicked (hit target is <div class="fixed.inset-0">): locator.click: Timeout 8000ms exceeded.';
const HUMAN_REASON =
    "the lobby offered neither Resume nor a selectable Deck Shelf tile — is the deployment seeded with preset decks?";

describe("classifyWalkFailure — a signature is recognised, never guessed", () => {
    it("a backend function past its execution limit in the console is INFRA function-timeout, whatever the walk threw", () => {
        expect(
            classifyWalkFailure({
                message: HUMAN_REASON,
                consoleErrors: [CONVEX_TIMEOUT_CONSOLE],
            })
        ).toEqual({ kind: "INFRA", signature: "function-timeout" });
    });

    it("a Convex server error in the console is INFRA server-error", () => {
        expect(
            classifyWalkFailure({
                message: HUMAN_REASON,
                consoleErrors: [
                    "Warning: validateDOMNesting(...)",
                    CONVEX_SERVER_ERROR_CONSOLE,
                ],
            })
        ).toEqual({ kind: "INFRA", signature: "server-error" });
    });

    it("the console outranks the message: a timed-out function behind a click timeout is function-timeout", () => {
        expect(
            classifyWalkFailure({
                message: CLICK_TIMEOUT,
                consoleErrors: [CONVEX_TIMEOUT_CONSOLE],
            })
        ).toEqual({ kind: "INFRA", signature: "function-timeout" });
    });

    it("a navigation that never answered is INFRA navigation-timeout", () => {
        expect(
            classifyWalkFailure({ message: GOTO_TIMEOUT, consoleErrors: [] })
        ).toEqual({ kind: "INFRA", signature: "navigation-timeout" });
    });

    it("a Playwright step timeout is INFRA step-timeout", () => {
        expect(
            classifyWalkFailure({ message: CLICK_TIMEOUT, consoleErrors: [] })
        ).toEqual({ kind: "INFRA", signature: "step-timeout" });
    });

    it("a screen that never settled is INFRA unsettled", () => {
        expect(
            classifyWalkFailure({
                message: `${UNSETTLED_MESSAGE_PREFIX} within 30s — 2 animation(s) running`,
                consoleErrors: [],
            })
        ).toEqual({ kind: "INFRA", signature: "unsettled" });
    });

    it("an unknown failure is UNWALKED — a walk's own reason, with an unrelated console error beside it", () => {
        expect(
            classifyWalkFailure({
                message: HUMAN_REASON,
                consoleErrors: [
                    "Warning: Each child in a list should have a unique key",
                ],
            })
        ).toEqual({ kind: "UNWALKED" });
    });
});

const POLICY: RetryPolicy = {
    maxAttempts: 3,
    loadThreshold: 8,
    pollMs: 5_000,
    maxWaitMs: 20_000,
};

describe("retryStep — a pure function of (attempts, load samples)", () => {
    it("samples before deciding anything: no sample yet is a zero wait", () => {
        expect(retryStep(1, [], POLICY)).toEqual({ action: "wait", ms: 0 });
    });

    it("waits one poll on a busy machine to see a trend, then while the load is FALLING", () => {
        expect(retryStep(1, [30], POLICY)).toEqual({
            action: "wait",
            ms: POLICY.pollMs,
        });
        expect(retryStep(1, [30, 8], POLICY)).toEqual({
            action: "wait",
            ms: POLICY.pollMs,
        });
    });

    it("retries as soon as a sample drops under the threshold", () => {
        expect(retryStep(1, [30, 12, 7.9], POLICY)).toEqual({
            action: "retry",
        });
        expect(retryStep(1, [7.9], POLICY)).toEqual({ action: "retry" });
    });

    it("retries when the load is not falling — a flat or rising load will not fall in 90s either (issue #4687)", () => {
        expect(retryStep(1, [30, 30], POLICY)).toEqual({ action: "retry" });
        expect(retryStep(1, [30, 31], POLICY)).toEqual({ action: "retry" });
        expect(retryStep(1, [12, 10, 10], POLICY)).toEqual({ action: "retry" });
    });

    it("bounds the wait: retries anyway once maxWaitMs of samples are spent", () => {
        // 5 samples = 4 waits x 5s = 20s = maxWaitMs, the load falling all along.
        expect(retryStep(2, [40, 36, 32, 28, 24], POLICY)).toEqual({
            action: "retry",
        });
        expect(retryStep(2, [40, 36, 32, 28], POLICY)).toEqual({
            action: "wait",
            ms: POLICY.pollMs,
        });
    });

    it("gives up at the attempt bound, however quiet the machine is", () => {
        expect(retryStep(3, [0.5], POLICY)).toEqual({ action: "give-up" });
        expect(retryStep(3, [], POLICY)).toEqual({ action: "give-up" });
    });
});

describe("standingVerdict — UNWALKED keeps its meaning", () => {
    it("stands as INFRA while the machine is still busy", () => {
        expect(standingVerdict(8, POLICY)).toBe("INFRA");
        expect(standingVerdict(41.2, POLICY)).toBe("INFRA");
    });

    it("is UNWALKED when the last attempt failed on a quiet machine", () => {
        expect(standingVerdict(7.99, POLICY)).toBe("UNWALKED");
    });
});

describe("infraDetail", () => {
    it("prints the signature and the load to one decimal", () => {
        expect(infraDetail("function-timeout", 23.437)).toBe(
            "function-timeout, load 23.4"
        );
    });
});
