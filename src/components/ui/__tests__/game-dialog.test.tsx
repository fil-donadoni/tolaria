import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GameDialog from "../game-dialog";

describe("GameDialog (issue #597, Zelda-TotK shape)", () => {
    it("renders the title with a full-width gold underline rule", () => {
        const { baseElement } = render(
            <GameDialog open title="Lightning Bolt">
                <p>body</p>
            </GameDialog>
        );
        expect(screen.getAllByText("Lightning Bolt").length).toBeGreaterThan(0);
        // the gold underline rule sits in the portal (baseElement = document.body)
        expect(
            baseElement.querySelectorAll(".panel-rule").length
        ).toBeGreaterThan(0);
    });

    it("renders the sunburst icon well when an icon is given", () => {
        const { baseElement } = render(
            <GameDialog open title="Game Over" icon={<span>skull</span>}>
                <p>body</p>
            </GameDialog>
        );
        expect(
            baseElement.querySelector('[data-slot="sunburst-icon"]')
        ).toBeTruthy();
    });

    it("renders an optional stats row", () => {
        render(
            <GameDialog
                open
                title="Damage"
                stats={<span data-testid="stat">3 → 6</span>}
            >
                <p>body</p>
            </GameDialog>
        );
        expect(screen.getByTestId("stat")).toBeTruthy();
    });

    it("renders a footer action row clear of the corner filigree", () => {
        render(
            <GameDialog open title="Confirm" footer={<button>Cancel</button>}>
                <p>body</p>
            </GameDialog>
        );
        expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    });

    it("still supports actions embedded in children (existing call-sites)", () => {
        render(
            <GameDialog open title='Delete "X"?' subtitle="Cannot be undone.">
                <div>
                    <button>Cancel</button>
                    <button>Delete</button>
                </div>
            </GameDialog>
        );
        expect(screen.getAllByText("Cannot be undone.").length).toBeGreaterThan(
            0
        );
        expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    });

    // ADR 0101 §2 / issue #2581: the default frame is the v3 bracket set, not
    // the 40px filigree. A dialog that says nothing gets brackets; only an
    // explicit `ornament` (Game Over / Match Result) brings the filigree back.
    it("renders the v3 corner brackets around the panel by default", () => {
        const { baseElement } = render(
            <GameDialog open title="Framed">
                <p>body</p>
            </GameDialog>
        );
        expect(
            baseElement.querySelectorAll('[data-slot="corner-bracket"]').length
        ).toBe(4);
        expect(
            baseElement.querySelectorAll('[data-slot="corner-filigree"]').length
        ).toBe(0);
    });

    it("brings back the filigree only when the caller opts into ornament", () => {
        const { baseElement } = render(
            <GameDialog open title="Framed" ornament>
                <p>body</p>
            </GameDialog>
        );
        expect(
            baseElement.querySelectorAll('[data-slot="corner-filigree"]').length
        ).toBe(4);
        // The brackets stay mounted as the phone-viewport fallback, hidden by
        // CSS above 844x390 (`compact-chrome:block`).
        const brackets = baseElement.querySelector(
            '[data-slot="corner-bracket-frame"]'
        )!;
        expect(brackets.className).toContain("compact-chrome:block");
    });

    it("keeps the dialog title clear of the corner bracket", () => {
        render(
            <GameDialog open title="Framed">
                <p>body</p>
            </GameDialog>
        );
        const title = screen.getByRole("heading", { name: "Framed" });
        // Arithmetic clearance, not geometry: happy-dom has no layout engine.
        // `.panel-title-clear` pays the shortfall between the panel padding at
        // the current density and `--panel-header-pad-x`; the token arithmetic
        // itself is asserted in `src/__tests__/design-tokens.test.ts`.
        expect(title.className).toContain("panel-title-clear");
    });

    it("offsets centering by half the right-piles strip so in-game dialogs sit over the play area", () => {
        // The board publishes `--right-piles-w` to documentElement while
        // mounted; the popup centers via the shared `.play-area-center-x`
        // utility (`left: calc(50% - strip/2)`) so it shifts left over the play
        // area. In the lobby the var is absent and the calc falls back to
        // `50% - 0px/2` = plain center (unchanged). The utility is the single
        // documented source of the play-area centering rule (index.css).
        const { baseElement } = render(
            <GameDialog open title="Offset">
                <p>body</p>
            </GameDialog>
        );
        const popup = baseElement.querySelector(
            '[data-slot="dialog-content"]'
        )!;
        expect(popup.className).toContain("play-area-center-x");
    });

    // issue #1817, opus review round 2: Panel already exposed a `density`
    // prop but GameDialog never forwarded it. Opt-in, default unchanged for
    // the ~10 other `size="wide"` call sites. v3 (#2581) renamed the rungs and
    // moved the padding onto `--panel-pad`, published as `data-density` — the
    // rung's actual padding value is asserted against `src/index.css` in
    // `src/__tests__/design-tokens.test.ts`, which is the only layer that can
    // resolve a custom property.
    it("forwards density to the inner Panel (opt-in, default unchanged)", () => {
        const { baseElement, rerender } = render(
            <GameDialog open title="Default density">
                <p>body</p>
            </GameDialog>
        );
        const panelDefault = baseElement.querySelector('[data-slot="panel"]')!;
        expect(panelDefault.getAttribute("data-density")).toBe("roomy");

        rerender(
            <GameDialog open title="Comfortable density" density="comfortable">
                <p>body</p>
            </GameDialog>
        );
        const panelCompact = baseElement.querySelector('[data-slot="panel"]')!;
        expect(panelCompact.getAttribute("data-density")).toBe("comfortable");
    });

    it("does not dismiss on overlay close when not dismissable", () => {
        const onOpenChange = vi.fn();
        render(
            <GameDialog
                open
                title="Locked"
                dismissable={false}
                onOpenChange={onOpenChange}
            >
                <p>body</p>
            </GameDialog>
        );
        fireEvent.keyDown(document.body, { key: "Escape" });
        expect(onOpenChange).not.toHaveBeenCalled();
    });

    // QA: the popup spans ~the whole play area so the backdrop is unreachable
    // — the popup itself emulates overlay dismissal (pile browse dialogs:
    // graveyard / library / hand / exile).
    it("dismisses when the click lands on the popup container itself", () => {
        const onOpenChange = vi.fn();
        const { baseElement } = render(
            <GameDialog open title="Browse" onOpenChange={onOpenChange}>
                <p>body</p>
            </GameDialog>
        );
        const popup = baseElement.querySelector(
            '[data-slot="dialog-content"]'
        )!;
        fireEvent.click(popup);
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("does NOT dismiss when the click lands inside the panel", () => {
        const onOpenChange = vi.fn();
        render(
            <GameDialog open title="Browse" onOpenChange={onOpenChange}>
                <p>body</p>
            </GameDialog>
        );
        fireEvent.click(screen.getByText("body"));
        expect(onOpenChange).not.toHaveBeenCalled();
    });

    it("does NOT dismiss on popup-container click when not dismissable", () => {
        const onOpenChange = vi.fn();
        const { baseElement } = render(
            <GameDialog
                open
                title="Locked"
                dismissable={false}
                onOpenChange={onOpenChange}
            >
                <p>body</p>
            </GameDialog>
        );
        const popup = baseElement.querySelector(
            '[data-slot="dialog-content"]'
        )!;
        fireEvent.click(popup);
        expect(onOpenChange).not.toHaveBeenCalled();
    });
});
