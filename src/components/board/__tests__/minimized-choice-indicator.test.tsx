// Collapsed stand-in for a minimized blocking choice dialog (issue #315).
// `minimize-choice.test.tsx` already covers the minimize/restore contract;
// this file is narrower and newer — issue #2730's v4 re-skin retired the
// `border-accent bg-accent-soft shadow-[...] animate-pulse` gold glow and
// the card-domain title face for the quiet HUD chip with a `dot-pulse-ring`
// status dot. Pins the new classes AND the absence of the retired ones, so
// a revert to the old recipe is caught here.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { PendingChoice } from "~/types/game";
import {
    MinimizedChoiceContext,
    type MinimizedChoice,
} from "~/hooks/useMinimizedChoice";
import MinimizedChoiceIndicator from "../minimized-choice-indicator";

afterEach(cleanup);

function choice(): PendingChoice {
    return {
        stackItemId: "stk",
        step: 0,
        choiceId: "me",
        playerId: "me",
        kind: "option-pick",
        prompt: "Choose one —",
        options: [],
    } as unknown as PendingChoice;
}

function renderIndicator(restore = vi.fn()) {
    const ctx: MinimizedChoice = {
        isMinimized: true,
        minimize: vi.fn(),
        restore,
    };
    return render(
        <MinimizedChoiceContext.Provider value={ctx}>
            <MinimizedChoiceIndicator choice={choice()} />
        </MinimizedChoiceContext.Provider>
    );
}

describe("MinimizedChoiceIndicator (issue #315)", () => {
    it("shows the label in the display face with a pulsing status dot, not the retired gold-glow recipe", () => {
        renderIndicator();
        const button = screen.getByRole("button", {
            name: /restore choice dialog/i,
        });
        expect(button.className).not.toContain("font-beleren");
        expect(button.className).not.toContain("bg-accent-soft");
        expect(button.className).not.toMatch(/shadow-\[0_0_30px/);
        const dot = button.querySelector("[aria-hidden]");
        expect(dot).not.toBeNull();
        expect(dot!.className).toContain("dot-pulse-ring");
        expect(dot!.className).toContain("bg-signal-pending");
    });

    it("restores the dialog on click", () => {
        const restore = vi.fn();
        renderIndicator(restore);
        fireEvent.click(
            screen.getByRole("button", { name: /restore choice dialog/i })
        );
        expect(restore).toHaveBeenCalled();
    });
});
