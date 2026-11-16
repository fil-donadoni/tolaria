// The one keycap primitive (issue #9833) and the icon-only control's tooltip
// that carries it.
import { afterEach, describe, expect, it } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { HOTKEYS } from "~/lib/hotkeys";
import { HotkeyTooltip } from "../hotkey-tooltip";
import { Keycap } from "../keycap";
import { TooltipProvider } from "../tooltip";

afterEach(cleanup);

function caps(container: HTMLElement): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>('[data-slot="kbd"]')];
}

describe("Keycap", () => {
    it("draws a letter as text, one boxed kbd in the tooltip's kbd slot", () => {
        const { container } = render(<Keycap hotkey={HOTKEYS.passTurn} />);
        const [cap] = caps(container);
        expect(caps(container)).toHaveLength(1);
        expect(cap.tagName).toBe("KBD");
        expect(cap.textContent).toBe("P");
        expect(cap.className).toContain("border");
    });

    it("draws Space and Enter as glyphs, not words", () => {
        for (const hotkey of [HOTKEYS.passPriority, HOTKEYS.passUntilAction]) {
            const { container, unmount } = render(<Keycap hotkey={hotkey} />);
            const [cap] = caps(container);
            expect(cap.querySelector("svg")).not.toBeNull();
            expect(cap.textContent).toBe("");
            unmount();
        }
    });

    it("draws a modifier + click as two caps joined by +", () => {
        const { container } = render(<Keycap hotkey={HOTKEYS.keepPriority} />);
        const [mod, click] = caps(container);
        expect(["⌘", "Ctrl"]).toContain(mod.textContent);
        expect(click.textContent).toBe("click");
        expect(container.textContent).toContain("+");
    });

    it("is never part of an accessible name", () => {
        render(
            <button type="button">
                Pass Turn
                <Keycap hotkey={HOTKEYS.passTurn} />
            </button>
        );
        expect(screen.getByRole("button", { name: "Pass Turn" })).toBeTruthy();
    });

    it("hides itself under a coarse pointer", () => {
        const { container } = render(<Keycap hotkey={HOTKEYS.passTurn} />);
        const root = container.querySelector('[data-slot="keycap"]')!;
        expect(root.className).toContain("pointer-coarse:hidden!");
    });
});

describe("HotkeyTooltip — an icon-only control's keycap", () => {
    it("keeps the trigger's own name and children, and adds aria-keyshortcuts", () => {
        render(
            <HotkeyTooltip
                label="Pass Turn"
                hotkey={HOTKEYS.passTurn}
                trigger={
                    <button type="button" aria-label="Pass Turn">
                        <svg data-testid="icon" />
                    </button>
                }
            />
        );
        const button = screen.getByRole("button", { name: "Pass Turn" });
        expect(button.getAttribute("aria-keyshortcuts")).toBe("P");
        expect(button.querySelector('[data-testid="icon"]')).not.toBeNull();
        expect(button.querySelector('[data-slot="keycap"]')).toBeNull();
    });

    it("shows the action's name and its keycap in the tooltip", async () => {
        // The app mounts every page under `main.tsx`'s TooltipProvider.
        render(
            <TooltipProvider>
                <HotkeyTooltip
                    label="Pass Turn"
                    hotkey={HOTKEYS.passTurn}
                    trigger={<button type="button" aria-label="Pass Turn" />}
                />
            </TooltipProvider>
        );
        const button = screen.getByRole("button", { name: "Pass Turn" });
        fireEvent.pointerEnter(button, { pointerType: "mouse" });
        fireEvent.mouseEnter(button);
        const popup = await waitFor(() => {
            const el = document.querySelector('[data-slot="tooltip-content"]');
            expect(el).not.toBeNull();
            return el;
        });
        expect(popup?.textContent).toContain("Pass Turn");
        expect(popup?.querySelector('[data-slot="kbd"]')?.textContent).toBe(
            "P"
        );
    });
});
