// StackModeLines renders a modal spell's chosen-mode caption on the stack
// (issue #1274, CR 700.2c): the chosen mode's oracle line is highlighted and
// flagged, the others are present but de-emphasized. Both players see it.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import StackModeLines from "../stack-mode-lines";
import type { StackModeLine } from "~/lib/card-utils";

const lines: StackModeLine[] = [
    {
        modeId: "mill",
        label: "Target player mills four cards",
        oracleText: "Target player mills four cards.",
        chosen: false,
    },
    {
        modeId: "land-type",
        label: "Change a land type until end of turn",
        oracleText: "Choose a land type and a basic land type.",
        chosen: true,
    },
    {
        modeId: "phase",
        label: "Target artifact phases out",
        oracleText: "Target artifact phases out.",
        chosen: false,
    },
];

afterEach(cleanup);

describe("StackModeLines (CR 700.2c chosen-mode highlight)", () => {
    it("renders every mode line and flags exactly the chosen one", () => {
        render(<StackModeLines lines={lines} />);
        const container = screen.getByTestId("stack-mode-lines");
        const rows = container.querySelectorAll("[data-mode-id]");
        expect(rows).toHaveLength(3);

        const chosen = container.querySelectorAll('[data-mode-chosen="true"]');
        expect(chosen).toHaveLength(1);
        expect(chosen[0].getAttribute("data-mode-id")).toBe("land-type");

        const notChosen = container.querySelectorAll(
            '[data-mode-chosen="false"]'
        );
        expect(notChosen).toHaveLength(2);
    });

    it("shows the chosen mode's oracle text", () => {
        render(<StackModeLines lines={lines} />);
        expect(
            screen.getByText(/Choose a land type and a basic land type/)
        ).toBeTruthy();
    });
});
