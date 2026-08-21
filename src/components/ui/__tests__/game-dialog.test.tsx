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

    // The icon used to be a sibling COLUMN of the whole content column, so a
    // dialog with an icon rendered its title, rule and body inside the width
    // LEFT OVER beside the icon — the Match Over screen's centred result
    // treatment then sat off-centre inside the panel by half the icon well.
    // The icon now lives in the header row and the column always spans the
    // panel, which is what these two assert together.
    it("keeps the content column spanning the panel when an icon is present", () => {
        const { baseElement } = render(
            <GameDialog open title="Game Over" icon={<span>skull</span>}>
                <p>body</p>
            </GameDialog>
        );
        const column = baseElement.querySelector(
            '[data-slot="game-dialog-column"]'
        )!;
        expect(column.className).toContain("w-full");
        // the icon is INSIDE the column, not a sibling of it
        expect(
            column.querySelector('[data-slot="sunburst-icon"]')
        ).toBeTruthy();
    });

    it("puts the icon beside the title when left-aligned and above it when centred", () => {
        const { baseElement, rerender } = render(
            <GameDialog open title="Left" icon={<span>i</span>}>
                <p>body</p>
            </GameDialog>
        );
        const headerRow = () =>
            baseElement.querySelector('[data-slot="sunburst-icon"]')!
                .parentElement!;
        expect(headerRow().className).not.toContain("flex-col");

        rerender(
            <GameDialog open align="center" title="Mid" icon={<span>i</span>}>
                <p>body</p>
            </GameDialog>
        );
        expect(headerRow().className).toContain("flex-col");
        expect(headerRow().className).toContain("items-center");
    });

    // A centred dialog (Coin toss, Game Over) must not keep the left-aligned
    // header language: a left title over a centred body reads as an accident.
    // `.panel-title-clear` is dropped with it — it pays an inline-START
    // padding, which would shift a centred title off centre, and a centred
    // title is already inset far past the 10px corner bracket.
    it("centres the title and drops the start-inset when align is center", () => {
        render(
            <GameDialog open align="center" title="Centred">
                <p>body</p>
            </GameDialog>
        );
        const title = screen.getByRole("heading", { name: "Centred" });
        expect(title.className).toContain("text-center");
        expect(title.className).not.toContain("panel-title-clear");
    });

    it("centres the subtitle only when align is center, and left-aligns it otherwise", () => {
        const { baseElement, rerender } = render(
            <GameDialog open title="T" subtitle="Sub line">
                <p>body</p>
            </GameDialog>
        );
        // the sr-only `DialogDescription` carries the same text — read the
        // VISIBLE one
        const visibleSubtitle = () =>
            Array.from(baseElement.querySelectorAll("p")).find(
                (el) =>
                    el.textContent === "Sub line" &&
                    !el.className.includes("sr-only")
            )!;
        expect(visibleSubtitle().className).toContain("text-left");

        rerender(
            <GameDialog open align="center" title="T" subtitle="Sub line">
                <p>body</p>
            </GameDialog>
        );
        expect(visibleSubtitle().className).toContain("text-center");
    });

    it("centres footer actions when align is center and right-aligns them otherwise", () => {
        const { rerender } = render(
            <GameDialog open title="T" footer={<button>Go</button>}>
                <p>body</p>
            </GameDialog>
        );
        const row = () =>
            screen.getByRole("button", { name: "Go" }).parentElement!;
        expect(row().className).toContain("sm:justify-end");

        rerender(
            <GameDialog
                open
                align="center"
                title="T"
                footer={<button>Go</button>}
            >
                <p>body</p>
            </GameDialog>
        );
        expect(row().className).toContain("sm:justify-center");
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
    //
    // No explicit `density` prop (issue #2595): GameDialog forwards
    // `undefined` to Panel by default, which then renders NO `data-density`
    // attribute of its own and inherits the ambient rung from `<html
    // data-density>` (the user's Settings preference) — see `Panel`'s own
    // "renders no data-density attribute" test.
    it("forwards density to the inner Panel (opt-in, default unchanged)", () => {
        const { baseElement, rerender } = render(
            <GameDialog open title="Default density">
                <p>body</p>
            </GameDialog>
        );
        const panelDefault = baseElement.querySelector('[data-slot="panel"]')!;
        expect(panelDefault.hasAttribute("data-density")).toBe(false);

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

    // Issue #2586 — the dialog must fit 844x390 (a landscape phone) by
    // scrolling INSIDE itself, never the page. happy-dom has no layout
    // engine (no viewport, no computed `max-height`), so this can only
    // assert the arithmetic/class contract, not the rendered pixels — the
    // pixel proof is the five-viewport browser receipt
    // (`.claude/rules/chrome-debug.md`). Two things must both hold: (1) the
    // column wrapping title/subtitle/body is height-capped even below the
    // 80vh breakpoint's usual floor (`short-viewport:max-h-[...]`, paired
    // with the `short-viewport` custom variant `@media (max-height: 500px)`
    // in src/index.css), and (2) the body itself is the scroll container
    // (`overflow-auto` + `min-h-0`, the only child allowed to grow past its
    // flex-basis) — a capped OUTER column with no scrolling INNER child
    // would just clip content instead of scrolling it.
    it("caps the content column's height under a short viewport and scrolls the body inside it, not the page", () => {
        const { baseElement } = render(
            <GameDialog open title="Tall content">
                <p>body</p>
            </GameDialog>
        );
        // The column publishes `data-slot="game-dialog-column"`. It used to be
        // reached as the title's `parentElement`, which stopped being the
        // column the moment the title gained a header ROW sibling to the icon
        // — a structural assumption the slot removes.
        const column = baseElement.querySelector(
            '[data-slot="game-dialog-column"]'
        )!;
        expect(column.className).toContain("max-h-[80vh]");
        expect(column.className).toContain(
            "short-viewport:max-h-[calc(100dvh-6rem)]"
        );

        const bodyScroller = screen.getByText("body").parentElement!;
        expect(bodyScroller.className).toContain("overflow-auto");
        expect(bodyScroller.className).toContain("min-h-0");
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
