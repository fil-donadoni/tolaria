// A control's hover tooltip (issue #9835) opens only after a 1 s hover —
// against the app provider's 0 — and carries the name, the description and,
// for an icon-only control, the keycap.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { HOTKEYS, type Hotkey } from "~/lib/hotkeys";
import { ControlTooltip } from "../control-tooltip";
import { TooltipProvider } from "../tooltip";

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

/** A mouse arriving on the control: base-ui's hover delay is a REST delay,
 *  timed from the last move over the trigger. */
function hover(trigger: HTMLElement) {
    act(() => {
        fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
        fireEvent.mouseEnter(trigger);
        fireEvent.mouseMove(trigger, { movementX: 4, movementY: 4 });
    });
}

function wait(ms: number) {
    act(() => {
        vi.advanceTimersByTime(ms);
    });
}

/** Mounted under the app's own provider (delay 0, as in `main.tsx`). */
function renderTip(hotkey?: Hotkey) {
    const view = render(
        <TooltipProvider>
            <ControlTooltip
                label="Pass Turn"
                description="Auto-pass priority until the turn ends"
                hotkey={hotkey}
                trigger={
                    <button type="button" aria-label="Pass Turn">
                        ⏩
                    </button>
                }
            />
        </TooltipProvider>
    );
    const trigger = view.getByRole("button", { name: "Pass Turn" });
    hover(trigger);
    return { trigger };
}

const content = () =>
    document.querySelector<HTMLElement>('[data-slot="tooltip-content"]');

describe("ControlTooltip (issue #9835)", () => {
    it("stays closed for the first second of hover, then opens", () => {
        renderTip();
        wait(999);
        expect(content()).toBeNull();
        wait(1);
        expect(content()).not.toBeNull();
    });

    it("closes on leave", () => {
        const { trigger } = renderTip();
        wait(1000);
        expect(trigger.hasAttribute("data-popup-open")).toBe(true);
        act(() => {
            fireEvent.pointerLeave(trigger, { pointerType: "mouse" });
            fireEvent.mouseLeave(trigger);
        });
        wait(1000);
        expect(trigger.hasAttribute("data-popup-open")).toBe(false);
    });

    it("shows the name, the description and an icon-only control's keycap", () => {
        const { trigger } = renderTip(HOTKEYS.passTurn);
        wait(1000);
        const tip = content()!;
        expect(
            tip.querySelector("[data-control-tooltip-label]")?.textContent
        ).toBe("Pass Turn");
        expect(
            tip.querySelector("[data-control-tooltip-description]")?.textContent
        ).toBe("Auto-pass priority until the turn ends");
        expect(
            tip.querySelector('[data-slot="kbd"]')?.getAttribute("data-key")
        ).toBe("P");
        expect(trigger.getAttribute("aria-keyshortcuts")).toBe("P");
    });

    it("a labelled control passes no hotkey: no keycap, its own aria-keyshortcuts kept", () => {
        const view = render(
            <TooltipProvider>
                <ControlTooltip
                    label="Pass"
                    trigger={
                        <button type="button" aria-keyshortcuts="Space">
                            Pass
                        </button>
                    }
                />
            </TooltipProvider>
        );
        const trigger = view.getByRole("button", { name: "Pass" });
        expect(trigger.getAttribute("aria-keyshortcuts")).toBe("Space");
        hover(trigger);
        wait(1000);
        expect(content()).not.toBeNull();
        expect(content()?.querySelector('[data-slot="kbd"]')).toBeNull();
    });
});
