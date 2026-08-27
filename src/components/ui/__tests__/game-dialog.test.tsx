import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GameDialog from "../game-dialog";

/** Token-exact className assertion helper (issue #2666, round-2 review).
 *  A plain `expect(el.className).toContain("flex")` is a raw substring
 *  match — it is satisfied by `flex-col`, `flex-1`, etc., so it does not
 *  guard the utility it names once a longer sibling utility sharing the
 *  same prefix is also present on the element. Splitting into
 *  whitespace-delimited tokens and asserting array membership makes the
 *  match exact instead of prefix-based. */
function classTokens(el: Element): string[] {
    return el.className.split(/\s+/).filter(Boolean);
}

describe("GameDialog (issue #597, Zelda-TotK shape)", () => {
    it("renders the title with a full-width hairline underline rule", () => {
        const { baseElement } = render(
            <GameDialog open title="Lightning Bolt">
                <p>body</p>
            </GameDialog>
        );
        expect(screen.getAllByText("Lightning Bolt").length).toBeGreaterThan(0);
        // the underline rule sits in the portal (baseElement = document.body)
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

    // ADR 0103 §5 / issue #2723: the dialog inherits Panel's v4 frame, which
    // has no corner ornament at all. A GameDialog draws neither the 40px
    // filigree (issue #595) nor the 10px brackets that replaced it (#2581) —
    // its frame is the panel's own hairline edge.
    it("renders no corner ornament around the panel", () => {
        const { baseElement } = render(
            <GameDialog open title="Framed">
                <p>body</p>
            </GameDialog>
        );
        expect(
            baseElement.querySelectorAll('[data-slot="corner-bracket"]').length
        ).toBe(0);
        expect(
            baseElement.querySelectorAll('[data-slot="corner-filigree"]').length
        ).toBe(0);
    });

    it("keeps the dialog title at the panel's own title inset", () => {
        render(
            <GameDialog open title="Framed">
                <p>body</p>
            </GameDialog>
        );
        const title = screen.getByRole("heading", { name: "Framed" });
        // Arithmetic, not geometry: happy-dom has no layout engine.
        // `.panel-title-clear` pays the shortfall between the panel padding at
        // the current density and `--panel-header-pad-x`, so a title living in
        // the Panel's padding box starts at the same inset from the panel
        // border as one in `PanelHeader`'s full-bleed band. The token
        // arithmetic itself is asserted in `src/__tests__/design-tokens.test.ts`.
        expect(classTokens(title)).toContain("panel-title-clear");
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
        expect(classTokens(column)).toContain("w-full");
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
        expect(classTokens(headerRow())).not.toContain("flex-col");

        rerender(
            <GameDialog open align="center" title="Mid" icon={<span>i</span>}>
                <p>body</p>
            </GameDialog>
        );
        expect(classTokens(headerRow())).toContain("flex-col");
        expect(classTokens(headerRow())).toContain("items-center");
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
        expect(classTokens(title)).toContain("text-center");
        expect(classTokens(title)).not.toContain("panel-title-clear");
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
        expect(classTokens(visibleSubtitle())).toContain("text-left");

        rerender(
            <GameDialog open align="center" title="T" subtitle="Sub line">
                <p>body</p>
            </GameDialog>
        );
        expect(classTokens(visibleSubtitle())).toContain("text-center");
    });

    it("centres footer actions when align is center and right-aligns them otherwise", () => {
        const { rerender } = render(
            <GameDialog open title="T" footer={<button>Go</button>}>
                <p>body</p>
            </GameDialog>
        );
        const row = () =>
            screen.getByRole("button", { name: "Go" }).parentElement!;
        expect(classTokens(row())).toContain("sm:justify-end");

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
        expect(classTokens(row())).toContain("sm:justify-center");
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
        expect(classTokens(popup)).toContain("play-area-center-x");
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

    // Issue #2586 / #2666 — the dialog must fit 844x390 (a landscape phone,
    // browser toolbar showing) by scrolling INSIDE itself, never the page,
    // with the footer (Submit/Cancel) staying reachable. happy-dom has no
    // layout engine (no viewport, no computed `max-height`), so this can
    // only assert the arithmetic/class contract, not the rendered pixels —
    // the pixel proof is the five-viewport browser receipt
    // (`.claude/rules/chrome-debug.md`).
    //
    // #2586 shipped the cap on the WRONG box: only the inner column (title +
    // body), not Panel itself — so the footer, a SIBLING of that column, sat
    // outside the cap and was exactly what overflowed. #2666 moves the cap
    // to Panel (the whole visible surface: header + scrolling body +
    // footer) and switches the base rung from `vh` to `dvh` (`vh` is the
    // LARGE viewport with the toolbar showing, so an 80vh/100vh cap still
    // overflows a short real viewport). Three things must all hold: (1)
    // Panel — not the column — carries the height cap, in `dvh`; (2) the
    // column has no cap of its own any more, only `min-h-0` so it can shrink
    // under Panel's squeeze; (3) the footer is `shrink-0` so 100% of that
    // squeeze lands on the column's own scroll region
    // (`overflow-auto` + `min-h-0`), never on the footer.
    it("caps the whole Panel (header+body+footer) at a dvh height, with the footer pinned outside the scrolling body", () => {
        const { baseElement } = render(
            <GameDialog
                open
                title="Tall content"
                footer={<button>Submit</button>}
            >
                <p>body</p>
            </GameDialog>
        );

        const panel = baseElement.querySelector('[data-slot="panel"]')!;
        expect(classTokens(panel)).toContain("max-h-[calc(100dvh-2rem)]");
        // A raw `toContain("flex")` substring check is satisfied by the
        // `flex-col` token alone, so it does not guard `display:flex` at
        // all (round-2 review, issue #2666) — proven by mutation: dropping
        // the standalone `flex` utility from Panel's className left this
        // assertion green while destroying the whole fix (Panel falls back
        // to `display:block`, the column can no longer flex-shrink, and the
        // footer clips instead of the body scrolling). `classTokens` makes
        // both checks exact-token, not prefix, matches.
        expect(classTokens(panel)).toContain("flex");
        expect(classTokens(panel)).toContain("flex-col");

        // The column publishes `data-slot="game-dialog-column"`. It used to be
        // reached as the title's `parentElement`, which stopped being the
        // column the moment the title gained a header ROW sibling to the icon
        // — a structural assumption the slot removes.
        const column = baseElement.querySelector(
            '[data-slot="game-dialog-column"]'
        )!;
        // Direction rule (round-3 review): substring vacuity only bites
        // `toContain` (presence) — over-matching there is fail-SILENT, a
        // token-exact check is required. `not.toContain` (absence) is the
        // opposite: over-matching can only produce a false FAILURE, never a
        // false pass, so a broader match is strictly safer, never vacuous.
        // This assertion must therefore stay a PREFIX search, not tighten to
        // an exact token — narrowing it to `c === "max-h-..."` would miss a
        // *variant-prefixed* cap (`sm:max-h-40`, `short-viewport:max-h-16`
        // in deck-legality-panel.tsx, `md:max-h-[...]` in dev-panel-rail.tsx
        // — all real utilities elsewhere in this repo) reintroducing the
        // #2666 footer clip at that breakpoint, silently. The regex allows
        // an optional `<variant>:` prefix before `max-h-`.
        expect(classTokens(column).some((c) => /(^|:)max-h-/.test(c))).toBe(
            false
        );
        expect(classTokens(column)).toContain("min-h-0");

        const bodyScroller = screen.getByText("body").parentElement!;
        expect(classTokens(bodyScroller)).toContain("overflow-auto");
        expect(classTokens(bodyScroller)).toContain("min-h-0");

        const footerEl = screen.getByText("Submit").parentElement!;
        expect(classTokens(footerEl)).toContain("shrink-0");
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
