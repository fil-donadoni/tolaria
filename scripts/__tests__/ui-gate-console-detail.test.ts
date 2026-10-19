// A browser console error, readable (issue #6072): React's `%o` format string
// hid a Convex query timeout behind five identical `%o` lines. The page-side
// reader runs here against plain values — the same function Playwright ships.
import { describe, expect, it } from "vitest";
import {
    consoleErrorDetail,
    type ConsoleMessageLike,
} from "../ui-gate/console-detail";

function message(text: string, values: unknown[]): ConsoleMessageLike {
    return {
        text: () => text,
        args: () =>
            values.map((value) => ({
                evaluate: async <R>(fn: (v: unknown) => R) => fn(value),
            })),
    };
}

describe("consoleErrorDetail", () => {
    it("resolves a format string's arguments — an Error by its stack", async () => {
        const err = new Error("[CONVEX Q(limitedEvents:x)] timed out");
        const detail = await consoleErrorDetail(
            message("%o", ["%o", err, { at: "Shell" }])
        );
        expect(detail).toContain(
            "Error: [CONVEX Q(limitedEvents:x)] timed out"
        );
        expect(detail).toContain('{"at":"Shell"}');
        expect(detail).not.toMatch(/\n/);
    });

    it("keeps a plain message as its text, never reading arguments", async () => {
        const msg = message("Failed to load resource", []);
        msg.args = () => {
            throw new Error("must not be read");
        };
        expect(await consoleErrorDetail(msg)).toBe("Failed to load resource");
    });

    it("falls back to the text when the page is gone", async () => {
        const msg: ConsoleMessageLike = {
            text: () => "%o",
            args: () => [
                {
                    evaluate: () => Promise.reject(new Error("Target closed")),
                },
            ],
        };
        expect(await consoleErrorDetail(msg)).toBe("%o");
    });
});
