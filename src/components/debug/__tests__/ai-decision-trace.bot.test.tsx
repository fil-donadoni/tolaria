import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup, screen, within } from "@testing-library/react";
import type {
    CandidateTrace,
    DecisionTrace,
    EvalTerms,
    Move,
} from "@convex/gre";
import { EVAL_TERM_LABELS } from "~/lib/ai/eval-term-labels";
import { MECHANISM_SENTENCES } from "~/lib/ai/decision-phrases";
import { pushAiTrace, clearAiTraces } from "~/lib/ai/trace-store";
import AiDecisionTrace from "../ai-decision-trace";

/**
 * The AI decision box, as a TESTER reads it (issue #3404, PRD #3397).
 *
 * Three properties, each of which the box shipped without and each of which
 * made it unusable for the person it is mounted for:
 *
 *   1. the last N decisions, not only the newest — the blunder is two decisions
 *      old by the time anyone opens the panel;
 *   2. a sentence, in words, naming why the move was taken and what the
 *      alternatives would have cost;
 *   3. the numbers still there, behind a disclosure rather than in front of it.
 */

const ZERO_TERMS: EvalTerms = {
    life: 0,
    hand: 0,
    creatures: 0,
    permanents: 0,
    mana: 0,
    manaDevelopment: 0,
    flexibility: 0,
    library: 0,
    graveyard: 0,
    graveyardReach: 0,
};

const PASS_MOVE: Move = { kind: "pass" };

function candidate(
    label: string,
    terms: Partial<EvalTerms> = {}
): CandidateTrace {
    return {
        label,
        move: PASS_MOVE,
        visits: 100,
        meanReward: 0.5,
        meanMargin: 0,
        avail: 100,
        eval: {
            self: { ...ZERO_TERMS, ...terms },
            opp: { ...ZERO_TERMS },
            margin: 0,
            danger: 0,
            total: 0,
        },
    };
}

/** A trace whose candidate list is the chosen move plus a `Pass` that would
 *  leave the bot two creature-floors worse off — the smallest fixture that
 *  produces a real comparison phrase. */
function trace(over: Partial<DecisionTrace> = {}): DecisionTrace {
    const chosen = over.chosen ?? "Cast Grizzly Bears";
    return {
        botId: "bot",
        iterationsCompleted: 400,
        iterationsRequested: 400,
        elapsedMs: 123.4,
        stoppedBy: "iterations",
        mechanism: "mean-reward",
        candidates: [
            candidate(chosen, {
                creatures: 6 * EVAL_TERM_LABELS.creatures.floor,
            }),
            candidate("Pass", {
                creatures: 4 * EVAL_TERM_LABELS.creatures.floor,
            }),
        ],
        ...over,
        chosen,
    };
}

beforeEach(() => {
    cleanup();
    clearAiTraces();
});

describe("AiDecisionTrace — the decision ring (issue #3404)", () => {
    it("shows nothing before the bot has thought", () => {
        render(<AiDecisionTrace />);
        expect(screen.getByText("No bot decision yet.")).toBeTruthy();
    });

    it("keeps earlier decisions instead of only the newest", () => {
        pushAiTrace(trace({ chosen: "Play Forest" }), "worker");
        pushAiTrace(trace({ chosen: "Cast Grizzly Bears" }), "worker");
        render(<AiDecisionTrace />);

        expect(screen.getAllByText(/Play Forest/).length).toBeGreaterThan(0);
        expect(
            screen.getAllByText(/Cast Grizzly Bears/).length
        ).toBeGreaterThan(0);
        expect(screen.getByText(/last decisions \(2\)/)).toBeTruthy();
    });

    it("puts the newest decision first", () => {
        pushAiTrace(trace({ chosen: "Play Forest" }), "worker");
        pushAiTrace(trace({ chosen: "Cast Grizzly Bears" }), "worker");
        const { container } = render(<AiDecisionTrace />);

        const rendered = container.textContent ?? "";
        expect(rendered.indexOf("Cast Grizzly Bears")).toBeLessThan(
            rendered.indexOf("Play Forest")
        );
    });

    it("drops a null trace rather than clearing what the ring already holds", () => {
        // A failed or empty consult has nothing to explain, and the decisions
        // the tester opened the panel for must survive it.
        pushAiTrace(trace({ chosen: "Play Forest" }), "worker");
        pushAiTrace(null, "worker");
        render(<AiDecisionTrace />);

        expect(screen.getAllByText(/Play Forest/).length).toBeGreaterThan(0);
        expect(screen.getByText(/last decisions \(1\)/)).toBeTruthy();
    });
});

describe("AiDecisionTrace — the reading in words (issue #3404)", () => {
    it("names the mechanism in a sentence, not by its identifier", () => {
        pushAiTrace(trace({ mechanism: "hold-trick" }), "worker");
        render(<AiDecisionTrace />);

        expect(
            screen.getByText(MECHANISM_SENTENCES["hold-trick"])
        ).toBeTruthy();
    });

    it("compares each alternative in eval-term words", () => {
        pushAiTrace(trace(), "worker");
        render(<AiDecisionTrace />);

        // "Pass" leaves the bot two creature-floors worse off than the cast.
        expect(screen.getByText("loses a creature")).toBeTruthy();
    });

    it("says when a tie-break, not the search, settled the pick", () => {
        pushAiTrace(trace({ mechanism: "free-development" }), "worker");
        render(<AiDecisionTrace />);
        expect(screen.getByText(/a tie-break decided this/)).toBeTruthy();

        cleanup();
        clearAiTraces();
        pushAiTrace(trace({ mechanism: "mean-reward" }), "worker");
        render(<AiDecisionTrace />);
        expect(screen.queryByText(/a tie-break decided this/)).toBeNull();
    });
});

describe("AiDecisionTrace — the fallback marker (issue #3404)", () => {
    it("marks a decision the Brain worker did not produce", () => {
        pushAiTrace(trace(), "inline");
        render(<AiDecisionTrace />);
        expect(screen.getByText("fallback")).toBeTruthy();
    });

    it("leaves an ordinary worker decision unmarked", () => {
        pushAiTrace(trace(), "worker");
        render(<AiDecisionTrace />);
        expect(screen.queryByText("fallback")).toBeNull();
    });
});

describe("AiDecisionTrace — the numbers (issue #3404)", () => {
    it("keeps the per-candidate trace line behind a disclosure", () => {
        pushAiTrace(trace(), "worker");
        const { container } = render(<AiDecisionTrace />);

        const details = container.querySelector("details");
        expect(details).toBeTruthy();
        expect(details!.hasAttribute("open")).toBe(false);

        // Every candidate, with its search stats — inside the disclosure, not
        // beside the words.
        const inside = within(details as HTMLElement);
        expect(inside.getAllByText("v100")).toHaveLength(2);
        expect(inside.getAllByText(/Cast Grizzly Bears|Pass/)).toHaveLength(2);
        expect(details!.textContent).toContain("400/400 iters (iterations)");
        expect(details!.textContent).toContain("123ms");
    });
});
