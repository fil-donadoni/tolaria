// The scenario preview renders the board its JSON describes, through the same
// renderer the verdict quiz uses (issue #3577) — and follows the edit.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    render,
    cleanup,
    screen,
    fireEvent,
    within,
} from "@testing-library/react";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("@convex/_generated/api", () => ({
    api: { debugScenarios: { saveDebugScenario: "debugScenarios:save" } },
}));

import DebugScenarioPreview from "../debug-scenario-preview";

beforeEach(() => cleanup());

describe("DebugScenarioPreview board (issue #3577)", () => {
    it("shows the spec as a board and re-reads it as the JSON is edited", () => {
        const { container } = render(
            <DebugScenarioPreview
                spec={{
                    cards: [
                        { name: "Grizzly Bears", owner: "opp" },
                        { name: "Shock", owner: "me", zone: "hand" },
                    ],
                }}
                unresolved={[]}
                initialLabel="preview"
                onSaved={() => {}}
                onDiscard={() => {}}
            />
        );
        const board = screen.getByTestId("scenario-board");
        expect(within(board).getByText("Grizzly Bears")).toBeTruthy();
        // The author sees every card they staged, hands included.
        expect(within(board).getByText("Shock")).toBeTruthy();

        const json = container.querySelector("textarea");
        if (!json) throw new Error("the preview renders no JSON textarea");
        fireEvent.change(json, {
            target: {
                value: JSON.stringify({
                    cards: [{ name: "Llanowar Elves", owner: "me" }],
                }),
            },
        });
        expect(
            within(screen.getByTestId("scenario-board")).getByText(
                "Llanowar Elves"
            )
        ).toBeTruthy();
    });
});
