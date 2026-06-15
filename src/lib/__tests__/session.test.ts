// @vitest-environment jsdom
// vs-AI difficulty persistence (issue #114): stored, defaulted, and tolerant of
// stale values. See `../session`.
import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_DIFFICULTY } from "@convex/gre";
import { getStoredDifficulty, storeDifficulty } from "../session";

describe("difficulty persistence (issue #114)", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("defaults to the default preset when unset", () => {
        expect(getStoredDifficulty()).toBe(DEFAULT_DIFFICULTY);
    });

    it("round-trips a stored difficulty", () => {
        storeDifficulty("hard");
        expect(getStoredDifficulty()).toBe("hard");
        storeDifficulty("easy");
        expect(getStoredDifficulty()).toBe("easy");
    });

    it("falls back to the default for a stale/invalid stored value", () => {
        localStorage.setItem("tolaria:aiDifficulty", "nightmare");
        expect(getStoredDifficulty()).toBe(DEFAULT_DIFFICULTY);
    });
});
