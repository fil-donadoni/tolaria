// Assertions read the DOM directly — see the note in `Term.test.tsx`.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shell } from "../Shell";
import { ShortcutsSheet } from "../ShortcutsSheet";
import { SHORTCUTS, openSheet, sheetOpen } from "../../lib/shortcuts";
import { resetOverlays } from "../../lib/overlays";

/**
 * The shortcuts sheet (#2635), rebuilt on a dialog primitive for PRD #3148 S2.
 *
 * These assertions came from `scripts/__tests__/dashboard-shortcuts.test.ts`,
 * where they had to drive a hand-built backdrop: its `[hidden]` cascade
 * against `dashboard.css`, its own `Tab`/`Shift+Tab` trap, and its own Escape
 * branch. All three are the primitive's now, so what is asserted here is the
 * BEHAVIOUR they existed to produce — a modal that lists every shortcut, that
 * a keyboard cannot walk out of, and that gives focus back.
 *
 * The cascade tests did not come across, and deliberately: the sheet's markup
 * is unmounted when closed rather than hidden with an attribute, so there is
 * no rule left for `dashboard.css` to win or lose against.
 */

const renderSheet = () =>
    render(
        <TooltipProvider>
            <ShortcutsSheet />
        </TooltipProvider>
    );

beforeEach(() => resetOverlays());
afterEach(() => resetOverlays());

describe("ShortcutsSheet — a sheet listing every shortcut", () => {
    it("renders one row per shortcut, from the SAME list the keydown switch dispatches from", async () => {
        renderSheet();
        act(() => openSheet());
        const dialog = await screen.findByRole("dialog");
        for (const s of SHORTCUTS) {
            expect(within(dialog).getByText(s.key)).not.toBeNull();
            expect(within(dialog).getByText(s.desc)).not.toBeNull();
        }
    });

    it("is reachable by clicking the header button — no shortcut knowledge required (#2635 AC)", async () => {
        render(
            <TooltipProvider>
                <Shell view="now" now={<div />} history={<div />} />
                <ShortcutsSheet />
            </TooltipProvider>
        );
        expect(screen.queryByRole("dialog")).toBeNull();
        fireEvent.click(
            screen.getByRole("button", { name: "Keyboard shortcuts" })
        );
        expect(await screen.findByRole("dialog")).not.toBeNull();
        expect(sheetOpen()).toBe(true);
    });

    it("closes on Escape, and on its own Close button", async () => {
        renderSheet();
        act(() => openSheet());
        await screen.findByRole("dialog");

        fireEvent.keyDown(document, { key: "Escape" });
        await waitFor(() => expect(sheetOpen()).toBe(false));

        act(() => openSheet());
        const dialog = await screen.findByRole("dialog");
        fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
        await waitFor(() => expect(sheetOpen()).toBe(false));
    });

    it("moves focus into the sheet and returns it to the opener on close — focus stays visible throughout", async () => {
        render(
            <TooltipProvider>
                <Shell view="now" now={<div />} history={<div />} />
                <ShortcutsSheet />
            </TooltipProvider>
        );
        const opener = screen.getByRole("button", {
            name: "Keyboard shortcuts",
        });
        opener.focus();
        fireEvent.click(opener);

        const dialog = await screen.findByRole("dialog");
        await waitFor(() => {
            expect(dialog.contains(document.activeElement)).toBe(true);
        });

        fireEvent.keyDown(document, { key: "Escape" });
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(document.activeElement).toBe(opener);
    });

    it("declares itself modal — nothing behind it is reachable while it is open", async () => {
        render(
            <TooltipProvider>
                <Shell view="now" now={<div />} history={<div />} />
                <ShortcutsSheet />
            </TooltipProvider>
        );
        act(() => openSheet());
        await screen.findByRole("dialog");
        // Asserted through the MECHANISM rather than through `aria-modal`:
        // base-ui inerts the page behind a modal dialog, which takes the whole
        // subtree out of the accessibility tree and out of the tab order at
        // once. That is strictly stronger than the attribute — and stronger
        // than the hand-rolled Tab trap it replaces, which could only cycle
        // focus back once it had already left.
        const inerted = document.querySelector("[data-base-ui-inert]");
        expect(inerted).not.toBeNull();
        expect(
            inerted!.querySelector("#shortcuts-btn"),
            "the header button is behind the inert boundary"
        ).not.toBeNull();
    });
});
