import type { ConnectionState } from "convex/browser";
import { collectAiDiagnostics, type AiDiagnostics } from "~/lib/ai/diagnostics";
import { collectBuildIdentity, type BuildIdentity } from "./build-identity";
import { getConsoleRing, type ConsoleEntry } from "./console-ring";
import { getFailedRequests, type FailedRequest } from "./network-ring";
import {
    collectViewportFacts,
    getStorageFacts,
    type StorageFacts,
    type ViewportFacts,
} from "./environment";
import { collectClientPreferences } from "./client-preferences";
import { collectMonitoringRef, type MonitoringRef } from "./monitoring";

/**
 * THE client-diagnostics payload (issue #2470, widened by issue #3256).
 *
 * One module decides what travels off a reporter's machine, and this is it. The
 * rule every section obeys: **an allowlist, never a denylist, and never a
 * wholesale dump** — of browser storage (`client-preferences.ts`), of network
 * traffic (`network-ring.ts` keeps method/path-shape/status and no bodies), of
 * anything. A denylist goes stale silently the first time a library renames a
 * key; an allowlist fails by omitting a field, which costs one report a
 * preference instead of costing a reporter their account.
 *
 * Every section is OPTIONAL and omitted entirely when it has nothing to say: a
 * report filed from the lobby must not carry empty scaffolding, because empty
 * scaffolding reads as evidence that something was checked and found empty.
 * `build` is the exception — it always has something to say, and it is the
 * single most useful field in the payload.
 *
 * Read at collection time, and a PURE read: collecting never clears a ring, so
 * the Debug panel and a second report still see what the first one took.
 */
export type ClientDiagnostics = {
    /** Which build, which backend, which mode. Always present. */
    build: BuildIdentity;
    /** The play bot's decision and escalation rings (issue #2470). */
    ai?: AiDiagnostics;
    /** Console output and uncaught failures, in the order the reporter saw
     *  them. */
    console?: ConsoleEntry[];
    /** Backend requests that FAILED, reduced to method/path-shape/status. */
    failedRequests?: FailedRequest[];
    /** The realtime subscription's state — a dropped subscription and a frozen
     *  bot are indistinguishable from a board snapshot. */
    connection?: ConnectionFacts;
    /** Viewport, DPR and the pointer/hover media queries. */
    viewport?: ViewportFacts;
    /** Storage quota and service-worker state, sampled at app start. */
    storage?: StorageFacts;
    /** Allowlisted `tolaria:` preferences — never the auth tokens that share
     *  this storage. */
    preferences?: Record<string, string>;
    /** How to find this session in the third-party monitor. */
    monitoring?: MonitoringRef;
};

/** The realtime facts, reduced from Convex's `ConnectionState`. Not the whole
 *  object: `timeOfOldestInflightRequest` is a `Date`, which does not survive
 *  the JSON round trip into the report row as anything a reader can trust. */
export type ConnectionFacts = {
    connected: boolean;
    /** Never connected at all is a different failure from reconnecting a lot. */
    everConnected: boolean;
    /** High === the client could not hold a stable connection. */
    connectionCount: number;
    retries: number;
    hasInflightRequests: boolean;
};

export type ClientDiagnosticsInput = {
    /** `ConvexReactClient.connectionState()`, read by the caller — this module
     *  must stay free of React and of the client instance. */
    connection?: ConnectionState;
};

export function collectClientDiagnostics(
    input: ClientDiagnosticsInput = {}
): ClientDiagnostics {
    const diagnostics: ClientDiagnostics = {
        build: collectBuildIdentity(),
    };

    const ai = collectAiDiagnostics();
    if (ai) diagnostics.ai = ai;

    const consoleRing = getConsoleRing();
    if (consoleRing.length > 0) diagnostics.console = consoleRing;

    const failed = getFailedRequests();
    if (failed.length > 0) diagnostics.failedRequests = failed;

    if (input.connection) {
        diagnostics.connection = {
            connected: input.connection.isWebSocketConnected,
            everConnected: input.connection.hasEverConnected,
            connectionCount: input.connection.connectionCount,
            retries: input.connection.connectionRetries,
            hasInflightRequests: input.connection.hasInflightRequests,
        };
    }

    try {
        diagnostics.viewport = collectViewportFacts();
    } catch {
        // A non-browser host has no viewport to report.
    }

    const storage = getStorageFacts();
    if (storage) diagnostics.storage = storage;

    const preferences = collectClientPreferences();
    if (preferences) diagnostics.preferences = preferences;

    const monitoring = collectMonitoringRef();
    if (monitoring) diagnostics.monitoring = monitoring;

    return diagnostics;
}

/**
 * The sections that are actually present, as plain English — what the consent
 * gate's one-line summary names (issue #3255). DERIVED from the payload, so a
 * section that stops being collected stops being claimed and a new one has to
 * be named here to compile.
 */
export function describeClientDiagnostics(
    diagnostics: ClientDiagnostics
): string[] {
    const parts = ["which build you are running"];
    if (diagnostics.ai) parts.push("the AI decision log");
    if (diagnostics.ai?.reportedDecision)
        // Named separately from the log above because it is a different
        // promise: not "which exits the driver took" but "the move you are
        // reporting, with every alternative the Bot weighed" (issue #3405).
        parts.push("the Bot decision you are reporting");
    if (diagnostics.console) parts.push("your recent console output");
    if (diagnostics.failedRequests) parts.push("backend requests that failed");
    if (diagnostics.connection) parts.push("your connection state");
    if (diagnostics.viewport) parts.push("your screen size");
    if (diagnostics.storage) parts.push("your storage and cache state");
    if (diagnostics.preferences) parts.push("your game preferences");
    if (diagnostics.monitoring) parts.push("an error-monitoring session id");
    return parts;
}
