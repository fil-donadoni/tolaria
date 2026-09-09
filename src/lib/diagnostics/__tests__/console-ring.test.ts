import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    CONSOLE_RING_LIMIT,
    MAX_ENTRY_CHARS,
    clearConsoleRing,
    getConsoleRing,
    installConsoleRing,
    recordConsoleEntry,
    scrubSecrets,
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

    // The network ring can promise "no query strings, ever" because it never
    // holds a URL. This one holds whatever the app logged, and an app logs
    // URLs — so the credential shapes are scrubbed on the way IN, at the one
    // door every writer goes through.
    it("scrubs a token out of anything logged", () => {
        const jwt =
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        console.error(
            `POST https://x.convex.cloud/api/run?token=${jwt} failed`,
            { authorization: `Bearer ${jwt}` }
        );

        const text = getConsoleRing().at(-1)!.text;
        expect(text).not.toContain(jwt);
        expect(text).not.toContain("eyJhbGciOiJIUzI1NiJ9");
        expect(text).toContain("[redacted");
        expect(text).toContain("/api/run");
    });

    it("scrubs before clamping, so a clamp cannot leave half a token", () => {
        const jwt = `eyJhbGciOi.${"a".repeat(MAX_ENTRY_CHARS)}.zzz`;
        recordConsoleEntry("log", jwt);
        expect(getConsoleRing().at(-1)!.text).not.toContain("eyJhbGciOi");
    });

    it("leaves ordinary output alone", () => {
        expect(scrubSecrets("[sw-cards] registration failed")).toBe(
            "[sw-cards] registration failed"
        );
    });

    // An Error thrown across a realm (the Brain Worker, an iframe) fails
    // `instanceof` — and stringifying it as JSON loses the message, the only
    // part worth keeping.
    it("keeps the message of a cross-realm error", () => {
        console.error({ name: "WorkerError", message: "script failed" });
        expect(getConsoleRing().at(-1)!.text).toBe(
            "WorkerError: script failed"
        );
    });

    it("does not throw when an error getter throws", () => {
        const hostile = {
            name: "Hostile",
            get message(): string {
                throw new Error("nope");
            },
        };
        expect(() => console.error(hostile)).not.toThrow();
        expect(getConsoleRing().at(-1)!.text).toBe("[unserializable]");
    });

    it("records nothing for an error event carrying neither error nor message", () => {
        const before = getConsoleRing().length;
        window.dispatchEvent(new Event("error"));
        expect(getConsoleRing()).toHaveLength(before);
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
