import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GameDialog from "../game-dialog";
import StatChip from "../stat-chip";

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

    it("renders an optional stat-chip row", () => {
        render(
            <GameDialog
                open
                title="Damage"
                stats={<StatChip from={3} to={6} />}
            >
                <p>body</p>
            </GameDialog>
        );
        expect(screen.getByText("3")).toBeTruthy();
        expect(screen.getByText("6")).toBeTruthy();
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

    it("renders the SVG corner filigree (subtle ornament) around the panel", () => {
        const { baseElement } = render(
            <GameDialog open title="Framed">
                <p>body</p>
            </GameDialog>
        );
        expect(
            baseElement.querySelectorAll('[data-slot="corner-filigree"]').length
        ).toBe(4);
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
});
