// How the verdict quiz's build settles (issue #9822): a throw on the way is a
// `builder-threw` refusal carrying the RAW cause — message and stack head, not
// only a minified code — and the report of a failed publish never throws.

import { describe, expect, it, vi } from "vitest";
import { describeCause, type QuizFeed } from "~/lib/ai/verdict-quiz";
import {
    reportQuizFailure,
    settleQuiz,
} from "../ai-decision-verdict-quiz-settle";

/** A feed whose position cannot be projected: `buildVerdictQuiz` throws. */
const BROKEN_FEED = {
    kind: "trace",
    trace: { chosen: "pass" },
    source: { state: null, botId: "bot" },
} as unknown as QuizFeed;

describe("settleQuiz (issue #9822)", () => {
    it("files a throw out of the builder as builder-threw, with the stack head", async () => {
        const settled = await settleQuiz(BROKEN_FEED);
        expect(settled.status).toBe("unbuildable");
        if (settled.status !== "unbuildable") return;
        expect(settled.refusal.kind).toBe("builder-threw");
        expect(settled.refusal.detail).toMatch(
            /^the quiz could not be built: /
        );
        // The raw cause: a frame, not only a message.
        expect(settled.refusal.detail).toMatch(/\n\s+at /);
    });

    it("hands the raw throw to onThrow, so a builder-threw is reported", async () => {
        const seen: unknown[] = [];
        await settleQuiz(BROKEN_FEED, (cause) => seen.push(cause));
        expect(seen).toHaveLength(1);
        expect(seen[0]).toBeInstanceOf(Error);
    });
});

describe("describeCause", () => {
    it("keeps the message and the head of the stack, capped", () => {
        const cause = new Error("Minified React error #185");
        const text = describeCause(cause, 3);
        expect(text).toContain("Minified React error #185");
        expect(text.split("\n").length).toBeLessThanOrEqual(3);
    });

    it("names a non-Error throw", () => {
        expect(describeCause("boom")).toBe("boom");
    });
});

describe("reportQuizFailure", () => {
    it("reports to the console and never throws", () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(() =>
            reportQuizFailure(
                new Error("x"),
                { id: 3, seq: 129, feed: null },
                "publish"
            )
        ).not.toThrow();
        expect(spy).toHaveBeenCalledOnce();
        spy.mockRestore();
    });
});
