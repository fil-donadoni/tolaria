import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    CONSOLE_RING_LIMIT,
    MAX_ENTRY_CHARS,
    clearConsoleRing,
    getConsoleRing,
    installConsoleRing,
    recordConsoleEntry,
} from "../console-ring";

// issue #3256 — the console ring. Bounded on BOTH axes on purpose: the whole
// ring travels inside a bug report, and one unclamped serialized object graph
// can push the row past Convex's 1 MB document limit, at which point the insert
// throws and the reporter loses the entire report.

describe("console ring (issue #3256)", () => {
    let uninstall: () => void = () => {};

    beforeEach(() => {
        clearConsoleRing();
        uninstall = installConsoleRing();
    });
    afterEach(() => {
        uninstall();
        clearConsoleRing();
    });

    it("drops the oldest entry past its capacity", () => {
        for (let i = 0; i < CONSOLE_RING_LIMIT + 25; i++) {
            recordConsoleEntry("log", `entry-${i}`);
        }
        const ring = getConsoleRing();
        expect(ring).toHaveLength(CONSOLE_RING_LIMIT);
        expect(ring[0]!.text).toBe("entry-25");
        expect(ring.at(-1)!.text).toBe(`entry-${CONSOLE_RING_LIMIT + 24}`);
    });

    it("clamps one oversized entry rather than letting it crowd the ring", () => {
        recordConsoleEntry("error", "y".repeat(MAX_ENTRY_CHARS * 3));
        const [entry] = getConsoleRing();
        expect(entry!.text).toHaveLength(MAX_ENTRY_CHARS + 1);
        expect(entry!.text.endsWith("…")).toBe(true);
    });

    // OBSERVES the console, never owns it: a devtools session must keep showing
    // exactly what it showed before this ring existed.
    it("records a console call and still calls through", () => {
        // The spy has to be in place BEFORE the wrapper installs: spying on an
        // already-wrapped method replaces the wrapper instead of chaining to
        // it, which is the same mistake a second instrumentation library would
        // make and the reason the wrapper must call the original it captured.
        uninstall();
        const original = console.warn;
        const spy = vi.fn();
        console.warn = spy;
        uninstall = installConsoleRing();

        console.warn("careful", { n: 1 });

        expect(spy).toHaveBeenCalledWith("careful", { n: 1 });
        const entry = getConsoleRing().at(-1);
        expect(entry?.level).toBe("warn");
        expect(entry?.text).toBe('careful {"n":1}');

        uninstall();
        console.warn = original;
        uninstall = () => {};
    });

    // A crash is only diagnosable next to the output that preceded it, which is
    // why these land in the SAME ring rather than an adjacent one.
    it("captures an uncaught error and an unhandled rejection", () => {
        console.log("just before");

        const errorEvent = new Event("error") as Event & { error?: unknown };
        errorEvent.error = new Error("kaboom");
        window.dispatchEvent(errorEvent);

        const rejection = new Event("unhandledrejection") as Event & {
            reason?: unknown;
        };
        rejection.reason = new Error("nobody caught me");
        window.dispatchEvent(rejection);

        const ring = getConsoleRing();
        expect(ring.map((e) => e.level).slice(-3)).toEqual([
            "log",
            "uncaught",
            "unhandledrejection",
        ]);
        expect(ring.at(-2)?.text).toBe("Error: kaboom");
        expect(ring.at(-1)?.text).toBe("Error: nobody caught me");
    });

    it("never throws on an unserializable argument", () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(() => console.log(circular)).not.toThrow();
        expect(getConsoleRing().at(-1)?.text).toBe("[unserializable]");
    });

    it("is idempotent, so a second install cannot double-record", () => {
        const second = installConsoleRing();
        console.log("once");
        second();
        expect(getConsoleRing().filter((e) => e.text === "once")).toHaveLength(
            1
        );
    });
});
