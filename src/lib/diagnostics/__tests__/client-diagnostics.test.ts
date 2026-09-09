import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    collectClientDiagnostics,
    describeClientDiagnostics,
} from "../client-diagnostics";
import { clearConsoleRing, recordConsoleEntry } from "../console-ring";
import { clearFailedRequests, recordFailedRequest } from "../network-ring";
import { clearStorageFacts } from "../environment";

// issue #3256 — the ONE module that decides what travels off a reporter's
// machine. What it must keep true: every section optional, absent when it has
// nothing to say (empty scaffolding reads as evidence that something was
// checked), and the build identity always there because it is the single most
// useful field in the payload.

const CONNECTED = {
    isWebSocketConnected: true,
    hasEverConnected: true,
    connectionCount: 3,
    connectionRetries: 1,
    hasInflightRequests: false,
    timeOfOldestInflightRequest: null,
    inflightMutations: 0,
    inflightActions: 0,
} as const;

describe("client diagnostics (issue #3256)", () => {
    beforeEach(() => {
        clearConsoleRing();
        clearFailedRequests();
        clearStorageFacts();
        localStorage.clear();
    });
    afterEach(() => {
        clearConsoleRing();
        clearFailedRequests();
        localStorage.clear();
    });

    // The Brain-Worker investigation behind this issue had to INFER the
    // reporter's build from the report's date. Certain beats inferred.
    it("always carries a non-empty build identity", () => {
        const { build } = collectClientDiagnostics();
        expect(build.commit).toBeTruthy();
        expect(build.commit.length).toBeGreaterThan(0);
        expect(build.mode).toBeTruthy();
        expect(build.deployment).toBeTruthy();
        expect(build.builtAt).toBeTruthy();
    });

    it("omits every empty section — a lobby report carries no scaffolding", () => {
        const diagnostics = collectClientDiagnostics();
        expect("ai" in diagnostics).toBe(false);
        expect("console" in diagnostics).toBe(false);
        expect("failedRequests" in diagnostics).toBe(false);
        expect("connection" in diagnostics).toBe(false);
        expect("storage" in diagnostics).toBe(false);
        expect("preferences" in diagnostics).toBe(false);
    });

    it("carries the sections that have something to say", () => {
        recordConsoleEntry("error", "it broke");
        recordFailedRequest({ method: "POST", path: "/api/x", status: 502 });
        localStorage.setItem("tolaria:playMode", "solo");

        const diagnostics = collectClientDiagnostics({
            connection: { ...CONNECTED },
        });

        expect(diagnostics.console).toHaveLength(1);
        expect(diagnostics.failedRequests).toHaveLength(1);
        expect(diagnostics.preferences).toEqual({ "tolaria:playMode": "solo" });
        expect(diagnostics.viewport?.width).toBeGreaterThanOrEqual(0);
    });

    // A dropped subscription and a frozen bot are indistinguishable from a
    // board snapshot — this is the field that tells them apart. `Date`-typed
    // fields are deliberately not carried: they do not survive the JSON round
    // trip into the row as anything a reader can trust.
    it("reduces the Convex connection state to JSON-safe facts", () => {
        const { connection } = collectClientDiagnostics({
            connection: { ...CONNECTED, isWebSocketConnected: false },
        });
        expect(connection).toEqual({
            connected: false,
            everConnected: true,
            connectionCount: 3,
            retries: 1,
            hasInflightRequests: false,
        });
    });

    // Sentry already receives this session's console and errors continuously
    // (disclosed by issue #3255's gate). Without a join key a maintainer
    // holding a row and a Sentry project could only line them up by guessing at
    // timestamps — which is exactly what the investigation behind this issue
    // had to do.
    it("carries the monitoring correlation id", () => {
        const { monitoring } = collectClientDiagnostics();
        expect(monitoring?.traceId).toBeTruthy();
        expect(typeof monitoring?.traceId).toBe("string");
    });

    it("is a pure read — collecting twice does not clear a ring", () => {
        recordConsoleEntry("warn", "still here");
        collectClientDiagnostics();
        expect(collectClientDiagnostics().console).toHaveLength(1);
    });

    // The consent gate's summary is DERIVED from this, so a section that starts
    // travelling has to be named here to compile.
    it("names only the sections actually present", () => {
        // The monitoring section is always present: a Sentry scope carries a
        // propagation trace id from the first render, initialised or not, and
        // that id is the join key a maintainer searches on.
        expect(describeClientDiagnostics(collectClientDiagnostics())).toEqual([
            "which build you are running",
            "your screen size",
            "an error-monitoring session id",
        ]);

        recordConsoleEntry("log", "hi");
        expect(describeClientDiagnostics(collectClientDiagnostics())).toContain(
            "your recent console output"
        );
    });
});
