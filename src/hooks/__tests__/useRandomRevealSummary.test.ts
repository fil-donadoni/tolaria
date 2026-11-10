// Issue #5519 — the summary toast of a finished Random Reveal (CR 705.2, PRD
// issue #4433): every reveal, single flips included, yields one client-only
// line once it stops being the prompt (the flipper's ack, or a viewer's
// lingering overlay closing).
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PendingChoice } from "~/types/game";
import { useRandomRevealSummary } from "~/hooks/useRandomRevealSummary";

const SQUEES_REVENGE = "2b391ee3-c1cd-47bc-9540-977cbc32913e";

const PLAYERS = [
    { id: "p1", name: "Alice" },
    { id: "p2", name: "Bob" },
];

function reveal(
    flips: PendingChoice["flips"],
    over: Partial<PendingChoice> = {}
): PendingChoice {
    return {
        stackItemId: "s1",
        step: 0,
        choiceId: "c1",
        playerId: "p1",
        kind: "random-reveal",
        count: 1,
        prompt: "Flip a coin",
        randomKind: "coin",
        sides: 2,
        flips,
        source: { cardId: SQUEES_REVENGE, controllerId: "p1" },
        ...over,
    };
}

const SERIES = reveal(
    [
        { flipperId: "p1", face: "heads", outcome: "win", round: 0 },
        { flipperId: "p1", face: "heads", outcome: "win", round: 1 },
        { flipperId: "p1", face: "heads", outcome: "win", round: 2 },
        { flipperId: "p1", face: "tails", outcome: "lose", round: 3 },
    ],
    { realized: { face: "LOSE", consequence: "Not every flip was won." } }
);

function render(viewerId: string) {
    return renderHook(
        ({ head }: { head: PendingChoice | null }) =>
            useRandomRevealSummary(head, PLAYERS, viewerId),
        { initialProps: { head: null as PendingChoice | null } }
    );
}

describe("useRandomRevealSummary (issue #5519)", () => {
    it("has nothing to say while the reveal is still the prompt", () => {
        const { result, rerender } = render("p1");
        rerender({ head: SERIES });
        expect(result.current.summary).toBeNull();
    });

    it("after the ack: source, tally and consequence, relative to the flipper", () => {
        const { result, rerender } = render("p1");
        rerender({ head: SERIES });
        rerender({ head: null });
        expect(result.current.summary?.message).toBe(
            "Squee's Revenge — You: 3 won, 1 lost. Not every flip was won."
        );
        expect(result.current.summary?.key).toBe("s1:c1");
    });

    it("names the flipper for the other seat", () => {
        const { result, rerender } = render("p2");
        rerender({ head: SERIES });
        rerender({ head: null });
        expect(result.current.summary?.message).toContain("Alice: 3 won");
    });

    it("also summarises a single flip", () => {
        const single = reveal(
            [{ flipperId: "p1", face: "tails", outcome: "lose", round: 0 }],
            { realized: { face: "LOSE", consequence: "Take 3 damage" } }
        );
        const { result, rerender } = render("p1");
        rerender({ head: single });
        rerender({ head: null });
        expect(result.current.summary?.message).toBe(
            "Squee's Revenge — You: 0 won, 1 lost. Take 3 damage"
        );
    });

    it("a second reveal replacing the first summarises the first", () => {
        const { result, rerender } = render("p1");
        rerender({ head: SERIES });
        rerender({ head: { ...SERIES, stackItemId: "s2" } });
        expect(result.current.summary?.key).toBe("s1:c1");
    });

    it("dismiss clears the toast", () => {
        const { result, rerender } = render("p1");
        rerender({ head: SERIES });
        rerender({ head: null });
        expect(result.current.summary).not.toBeNull();
        result.current.dismiss();
        rerender({ head: null });
        expect(result.current.summary).toBeNull();
    });
});
