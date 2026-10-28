// Issue #5516 — a viewer's Random Reveal (CR 705.2, ADR 0023) keeps playing
// after the Bot's ack removed the pending choice, then closes by itself once
// the shared pacing-table duration has elapsed. The flipper's own client is
// never held.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingChoice } from "~/types/game";
import { useLingeringRandomReveal } from "~/hooks/useLingeringRandomReveal";
import { revealDurationMs } from "~/lib/random-reveal-pacing";

const HUMAN = "u1-p1";
const BOT = "u1-p2";

function reveal(playerId: string, choiceId = "c1"): PendingChoice {
    return {
        kind: "random-reveal",
        randomKind: "coin",
        playerId,
        choiceId,
        stackItemId: "s1",
        result: 1,
    } as unknown as PendingChoice;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useLingeringRandomReveal (issue #5516)", () => {
    it("keeps a viewer's reveal after the head is gone, then closes on its own", () => {
        const head = reveal(BOT);
        const { result, rerender } = renderHook(
            ({ h }: { h: PendingChoice | undefined }) =>
                useLingeringRandomReveal(h, HUMAN),
            { initialProps: { h: head as PendingChoice | undefined } }
        );
        expect(result.current).toBeNull(); // the live head renders itself

        act(() => {
            vi.advanceTimersByTime(300);
        });
        rerender({ h: undefined });
        expect(result.current).toBe(head);

        act(() => {
            vi.advanceTimersByTime(revealDurationMs() - 300 - 1);
        });
        expect(result.current).toBe(head);

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(result.current).toBeNull();
    });

    it("never holds the flipper's own reveal", () => {
        const { result, rerender } = renderHook(
            ({ h }: { h: PendingChoice | undefined }) =>
                useLingeringRandomReveal(h, HUMAN),
            { initialProps: { h: reveal(HUMAN) as PendingChoice | undefined } }
        );
        rerender({ h: undefined });
        expect(result.current).toBeNull();
    });
});
