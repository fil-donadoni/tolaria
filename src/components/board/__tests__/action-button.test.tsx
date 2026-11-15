// The board action button's hotkey is shown as the shared keycap (issue
// #9833) and is presentation only (issue #9088): since PR #8958 gave Pass Turn
// the text shortcut `P`, the hint leaked into the button's accessible name
// ("Pass Turn [P]") and `check:ui`'s game-board assertion — `role=button
// name="Pass Turn"` — stopped finding it.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HOTKEYS } from "~/lib/hotkeys";
import ActionButton from "../action-button";

describe("ActionButton — the keycap never names the button (issues #9088, #9833)", () => {
    afterEach(cleanup);

    it.each([
        ["passTurn", "P"],
        ["passPriority", "Space"],
        ["passUntilAction", "Enter"],
    ] as const)(
        "a %s keycap leaves the accessible name as the label alone",
        (id, aria) => {
            render(
                <ActionButton
                    onClick={() => {}}
                    label="Pass Turn"
                    shortcut={HOTKEYS[id]}
                />
            );
            const button = screen.getByRole("button", { name: "Pass Turn" });
            expect(button.getAttribute("aria-keyshortcuts")).toBe(aria);
        }
    );

    it("draws the declared key as the shared keycap after the label", () => {
        render(
            <ActionButton
                onClick={() => {}}
                label="Pass Turn"
                shortcut={HOTKEYS.passTurn}
            />
        );
        const button = screen.getByRole("button", { name: "Pass Turn" });
        const cap = button.querySelector('[data-slot="keycap"]');
        expect(cap?.getAttribute("aria-hidden")).toBe("true");
        expect(cap?.querySelector('[data-slot="kbd"]')?.textContent).toBe("P");
        expect(button.textContent).not.toContain("[P]");
    });

    it("no shortcut, no keycap and no aria-keyshortcuts", () => {
        render(<ActionButton onClick={() => {}} label="Pass" />);
        const button = screen.getByRole("button", { name: "Pass" });
        expect(button.hasAttribute("aria-keyshortcuts")).toBe(false);
        expect(button.querySelector('[data-slot="keycap"]')).toBeNull();
    });
});
