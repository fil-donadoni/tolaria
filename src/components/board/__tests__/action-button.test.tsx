// The board action button's keyboard hint is presentation only (issue #9088):
// since PR #8958 gave Pass Turn the text shortcut `P`, the hint leaked into the
// button's accessible name ("Pass Turn [P]") and `check:ui`'s game-board
// assertion — `role=button name="Pass Turn"` — stopped finding it.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ActionButton from "../action-button";

describe("ActionButton — the shortcut hint never names the button (issue #9088)", () => {
    afterEach(cleanup);

    it.each(["P", "Space", "Enter"])(
        "a %s hint leaves the accessible name as the label alone",
        (shortcut) => {
            render(
                <ActionButton
                    onClick={() => {}}
                    label="Pass Turn"
                    shortcut={shortcut}
                />
            );
            const button = screen.getByRole("button", { name: "Pass Turn" });
            expect(button.getAttribute("aria-keyshortcuts")).toBe(shortcut);
        }
    );

    it("still shows the text hint", () => {
        render(
            <ActionButton onClick={() => {}} label="Pass Turn" shortcut="P" />
        );
        expect(screen.getByText("[P]")).toBeTruthy();
    });

    it("no shortcut, no aria-keyshortcuts", () => {
        render(<ActionButton onClick={() => {}} label="Pass" />);
        expect(
            screen
                .getByRole("button", { name: "Pass" })
                .hasAttribute("aria-keyshortcuts")
        ).toBe(false);
    });
});
