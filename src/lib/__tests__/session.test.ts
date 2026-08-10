// @vitest-environment happy-dom
// vs-AI difficulty persistence (issue #114): stored, defaulted, and tolerant of
// stale values. See `../session`.
import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_DIFFICULTY } from "@convex/gre";
import {
    DEFAULT_DECK_FORMAT_FILTER,
    DEFAULT_MATCH_FORMAT,
    getStoredDeckFormatFilter,
    getStoredDifficulty,
    getStoredMatchFormat,
    storeDeckFormatFilter,
    storeDifficulty,
    storeMatchFormat,
} from "../session";

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

describe("match format persistence (PRD #387)", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("defaults to Bo1 when unset", () => {
        expect(getStoredMatchFormat()).toBe(DEFAULT_MATCH_FORMAT);
        expect(DEFAULT_MATCH_FORMAT).toBe(1);
    });

    it("round-trips Bo1 and Bo3", () => {
        storeMatchFormat(3);
        expect(getStoredMatchFormat()).toBe(3);
        storeMatchFormat(1);
        expect(getStoredMatchFormat()).toBe(1);
    });

    it("falls back to Bo1 for a stale/invalid stored value", () => {
        localStorage.setItem("tolaria:matchFormat", "7");
        expect(getStoredMatchFormat()).toBe(1);
    });
});

describe("deck-list format filter persistence (issue #513)", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("defaults to 'all' when unset", () => {
        expect(getStoredDeckFormatFilter()).toBe(DEFAULT_DECK_FORMAT_FILTER);
        expect(DEFAULT_DECK_FORMAT_FILTER).toBe("all");
    });

    it("round-trips 'all' and each FormatId", () => {
        storeDeckFormatFilter("alpha-40");
        expect(getStoredDeckFormatFilter()).toBe("alpha-40");
        storeDeckFormatFilter("old-school");
        expect(getStoredDeckFormatFilter()).toBe("old-school");
        storeDeckFormatFilter("all");
        expect(getStoredDeckFormatFilter()).toBe("all");
    });

    it("falls back to 'all' for a stale/invalid stored value", () => {
        localStorage.setItem("tolaria:deckFormatFilter", "modern");
        expect(getStoredDeckFormatFilter()).toBe("all");
    });
});
