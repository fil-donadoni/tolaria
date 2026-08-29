import { describe, it, expect } from "vitest";
import { parseOpencodeMessageData } from "../lib/opencode-telemetry";

/**
 * opencode token mapping (opencode-telemetry.ts). The sqlite-bound reader and
 * the ingest's harness threading are exercised operationally (they need the
 * Bun-only `bun:sqlite`); the token-mapping rules are pure and live here so a
 * wrong mapping is caught at the gate, not on the dashboard.
 */
describe("parseOpencodeMessageData", () => {
    it("folds reasoning into out_tok and maps cache read/write straight across", () => {
        const t = parseOpencodeMessageData(
            JSON.stringify({
                role: "assistant",
                modelID: "deepseek-v4-pro",
                tokens: {
                    input: 16345,
                    output: 179,
                    reasoning: 20,
                    cache: { read: 100, write: 0 },
                },
                time: { created: 1783610293247 },
            }),
            null
        )!;
        expect(t.modelId).toBe("deepseek-v4-pro");
        expect(t.inTok).toBe(16345);
        expect(t.outTok).toBe(199); // 179 + 20
        expect(t.cacheRead).toBe(100);
        expect(t.cacheWrite).toBe(0);
        expect(t.tsMs).toBe(1783610293247);
    });

    it("falls back to the session model when a message omits modelID", () => {
        const t = parseOpencodeMessageData(
            JSON.stringify({
                role: "assistant",
                tokens: { input: 1, output: 2 },
            }),
            "deepseek-v4-flash"
        )!;
        expect(t.modelId).toBe("deepseek-v4-flash");
    });

    it("returns null for non-assistant lines", () => {
        expect(
            parseOpencodeMessageData(
                JSON.stringify({ role: "user", tokens: { input: 1 } }),
                null
            )
        ).toBeNull();
    });

    it("returns null for malformed JSON", () => {
        expect(parseOpencodeMessageData("{not json", null)).toBeNull();
    });

    it("treats missing tokens as zeros", () => {
        const t = parseOpencodeMessageData(
            JSON.stringify({ role: "assistant" }),
            "deepseek-v4-pro"
        )!;
        expect(t.inTok).toBe(0);
        expect(t.outTok).toBe(0);
        expect(t.cacheRead).toBe(0);
        expect(t.cacheWrite).toBe(0);
    });
});
