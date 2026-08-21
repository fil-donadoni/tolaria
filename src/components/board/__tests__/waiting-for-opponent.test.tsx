// Host-side discoverability of the join code (issue #2649). A code nobody can
// read is not a feature: this screen is the code's ENTIRE lifetime on screen —
// the server clears `joinCode` as the second seat is filled, so once the game
// leaves `waiting` this component never renders again.
//
// The `joinCode` prop is optional on purpose, and the "absent" case is not
// hypothetical: a Limited challenge, a Tabletop table and every `games` row
// written before this slice all reach `waiting` with no code. Those must keep
// the pre-#2649 invite-link screen rather than rendering an empty code slot.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

import type { Id } from "@convex/_generated/dataModel";
import WaitingForOpponent from "../waiting-for-opponent";

const copyText = vi.fn();
vi.mock("~/lib/clipboard", () => ({
    copyText: (t: string) => copyText(t),
    copyMinified: vi.fn(),
}));

const GAME_ID = "game-1" as Id<"games">;

afterEach(() => {
    cleanup();
    copyText.mockClear();
});

describe("WaitingForOpponent join code (issue #2649)", () => {
    it("shows the code GROUPED for reading aloud but copies the raw value", () => {
        const { getByText, getByRole } = render(
            <WaitingForOpponent
                gameId={GAME_ID}
                joinCode="K3M9XZ"
                onLeave={vi.fn()}
            />
        );
        // Grouped on screen — the dash is a reading aid.
        expect(getByText("K3M-9XZ")).toBeTruthy();
        fireEvent.click(getByRole("button", { name: "Copy join code" }));
        // ...and NOT part of the value the other player has to type. The
        // normalizer would strip it, but pasting a dash into a 6-char field
        // truncates the code, so the raw value is what goes on the clipboard.
        expect(copyText).toHaveBeenCalledWith("K3M9XZ");
    });

    it("still offers the invite link alongside the code", () => {
        const { getByRole } = render(
            <WaitingForOpponent
                gameId={GAME_ID}
                joinCode="K3M9XZ"
                onLeave={vi.fn()}
            />
        );
        fireEvent.click(getByRole("button", { name: "Share invite link" }));
        expect(copyText).toHaveBeenCalledWith(
            expect.stringContaining(`/join/${GAME_ID}`)
        );
    });

    it("falls back to the game-ID screen when the table has no code", () => {
        const { queryByRole, getByText } = render(
            <WaitingForOpponent gameId={GAME_ID} onLeave={vi.fn()} />
        );
        expect(queryByRole("button", { name: "Copy join code" })).toBeNull();
        expect(getByText(`Game ID: ${GAME_ID}`)).toBeTruthy();
    });
});
