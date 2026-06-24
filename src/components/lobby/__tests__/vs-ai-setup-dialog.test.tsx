// Two-step "Play vs AI" setup dialog: the second step that collects difficulty,
// match format, and AI opponent deck, and only fires the create mutation on
// Confirm. The player's OWN deck stays the Lobby hero selection and is NOT asked
// here. See `../vs-ai-setup-dialog`.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { LobbyDeck } from "~/lib/deckTypes";
import VsAiSetupDialog from "../vs-ai-setup-dialog";

const DECKS: LobbyDeck[] = [
    {
        kind: "preset",
        presetId: "mono-red-burn",
        name: "Mono Red Burn",
        format: "old-school",
        colors: ["R"],
        cards: [],
        featuredCardId: null,
        isLegal: true,
        reasons: [],
    },
    {
        kind: "preset",
        presetId: "white-weenie",
        name: "White Weenie",
        format: "old-school",
        colors: ["W"],
        cards: [],
        featuredCardId: null,
        isLegal: true,
        reasons: [],
    },
];

function renderDialog(
    overrides: Partial<Parameters<typeof VsAiSetupDialog>[0]> = {}
) {
    const props = {
        open: true,
        onOpenChange: vi.fn(),
        difficulty: "medium" as const,
        onDifficultyChange: vi.fn(),
        matchFormat: 1 as const,
        onMatchFormatChange: vi.fn(),
        decks: DECKS,
        aiDeckId: null,
        onAiDeckChange: vi.fn(),
        onConfirm: vi.fn(),
        pending: false,
        ...overrides,
    };
    return { props, ...render(<VsAiSetupDialog {...props} />) };
}

describe("VsAiSetupDialog", () => {
    it("renders the three vs-AI selectors when open", () => {
        const { getByLabelText } = renderDialog();
        expect(getByLabelText("AI Difficulty")).toBeTruthy();
        expect(getByLabelText("Match Format")).toBeTruthy();
        expect(getByLabelText("AI Opponent Deck")).toBeTruthy();
    });

    it("does not render its content while closed", () => {
        const { queryByLabelText } = renderDialog({ open: false });
        expect(queryByLabelText("AI Difficulty")).toBeNull();
    });

    it("fires onConfirm when the primary 'Play vs AI' button is clicked", () => {
        const onConfirm = vi.fn();
        const { getByRole } = renderDialog({ onConfirm });
        fireEvent.click(getByRole("button", { name: "Play vs AI" }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it("closes via onOpenChange(false) when Cancel is clicked", () => {
        const onOpenChange = vi.fn();
        const onConfirm = vi.fn();
        const { getByText } = renderDialog({ onOpenChange, onConfirm });
        fireEvent.click(getByText("Cancel"));
        expect(onOpenChange).toHaveBeenCalledWith(false);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it("forwards selector changes to the lobby setters", () => {
        const onDifficultyChange = vi.fn();
        const onMatchFormatChange = vi.fn();
        const onAiDeckChange = vi.fn();
        const { getByText, getByLabelText } = renderDialog({
            onDifficultyChange,
            onMatchFormatChange,
            onAiDeckChange,
        });
        fireEvent.click(getByText("Hard"));
        expect(onDifficultyChange).toHaveBeenCalledWith("hard");
        fireEvent.click(getByText("Bo3"));
        expect(onMatchFormatChange).toHaveBeenCalledWith(3);
        fireEvent.change(getByLabelText("AI Opponent Deck"), {
            target: { value: "white-weenie" },
        });
        expect(onAiDeckChange).toHaveBeenCalledWith("white-weenie");
    });

    it("disables Confirm and Cancel while the create mutation is pending", () => {
        const onConfirm = vi.fn();
        const { getByRole } = renderDialog({ pending: true, onConfirm });
        const confirm = getByRole("button", {
            name: "Play vs AI",
        }) as HTMLButtonElement;
        const cancel = getByRole("button", {
            name: "Cancel",
        }) as HTMLButtonElement;
        expect(confirm.disabled).toBe(true);
        expect(cancel.disabled).toBe(true);
        fireEvent.click(confirm);
        expect(onConfirm).not.toHaveBeenCalled();
    });
});
