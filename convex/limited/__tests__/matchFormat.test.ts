// Match Format + round deadline configuration (PRD #1628 stories 1-4, ADR
// 0076, issue #1640). The default is a PRODUCT decision (story 2: Bo3 so the
// event plays like real Limited with nothing configured), and the tolerant
// read is a MIGRATION decision (the stored field is optional so events created
// before the play phase existed keep validating) — both are pinned here so
// neither can be changed by accident.
import { describe, it, expect } from "vitest";
import {
    DEFAULT_MATCH_FORMAT,
    DEFAULT_ROUND_DEADLINE_MINUTES,
    LIMITED_MATCH_FORMATS,
    MAX_ROUND_DEADLINE_MINUTES,
    MIN_ROUND_DEADLINE_MINUTES,
    bestOfForMatchFormat,
    gamesToWinMatch,
    isLimitedMatchFormat,
    isValidRoundDeadlineMinutes,
    resolveMatchFormat,
} from "../matchFormat";

describe("Match Format (PRD #1628 stories 1-2)", () => {
    it("offers exactly Bo1 and Bo3", () => {
        expect([...LIMITED_MATCH_FORMATS]).toEqual(["bo1", "bo3"]);
    });

    it("defaults to Bo3 (story 2: real Limited with nothing configured)", () => {
        expect(DEFAULT_MATCH_FORMAT).toBe("bo3");
    });

    it("resolves an absent stored value to the default", () => {
        expect(resolveMatchFormat(undefined)).toBe("bo3");
    });

    it("never overrides an explicitly stored choice", () => {
        expect(resolveMatchFormat("bo1")).toBe("bo1");
        expect(resolveMatchFormat("bo3")).toBe("bo3");
    });

    it("maps to the existing Match/Game flow's bestOf (ADR 0029)", () => {
        expect(bestOfForMatchFormat("bo1")).toBe(1);
        expect(bestOfForMatchFormat("bo3")).toBe(3);
    });

    it("knows how many games WIN a match of each format (story 28)", () => {
        expect(gamesToWinMatch("bo1")).toBe(1);
        expect(gamesToWinMatch("bo3")).toBe(2);
    });

    it("parses only the two real formats at the outside boundary", () => {
        expect(isLimitedMatchFormat("bo1")).toBe(true);
        expect(isLimitedMatchFormat("bo3")).toBe(true);
        expect(isLimitedMatchFormat("bo5")).toBe(false);
        expect(isLimitedMatchFormat("BO3")).toBe(false);
        expect(isLimitedMatchFormat("")).toBe(false);
    });
});

describe("round deadline bounds (PRD #1628 stories 3-4)", () => {
    it("accepts both ends of the allowed range", () => {
        expect(isValidRoundDeadlineMinutes(MIN_ROUND_DEADLINE_MINUTES)).toBe(
            true
        );
        expect(isValidRoundDeadlineMinutes(MAX_ROUND_DEADLINE_MINUTES)).toBe(
            true
        );
    });

    it("offers a real Limited round length as the on-switch default", () => {
        expect(
            isValidRoundDeadlineMinutes(DEFAULT_ROUND_DEADLINE_MINUTES)
        ).toBe(true);
        expect(DEFAULT_ROUND_DEADLINE_MINUTES).toBe(50);
    });

    it("rejects the values an unbounded v.number() would otherwise store", () => {
        // Each of these yields a `deadlineAt` that is instantly expired or
        // unreachable — the whole reason the mutation range-checks.
        expect(isValidRoundDeadlineMinutes(0)).toBe(false);
        expect(isValidRoundDeadlineMinutes(-30)).toBe(false);
        expect(isValidRoundDeadlineMinutes(Number.NaN)).toBe(false);
        expect(isValidRoundDeadlineMinutes(Number.POSITIVE_INFINITY)).toBe(
            false
        );
        expect(isValidRoundDeadlineMinutes(12.5)).toBe(false);
        expect(
            isValidRoundDeadlineMinutes(MAX_ROUND_DEADLINE_MINUTES + 1)
        ).toBe(false);
    });
});
