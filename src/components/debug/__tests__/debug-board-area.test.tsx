// The board area gives up the debug sheet's width at desktop widths while the
// sheet is OPEN (issue #3493) — the sheet sits BESIDE the board instead of
// painting over half a battlefield.
//
// What this file can pin is the WIRING: which class the wrapper carries for a
// given open flag, that the class is the shared one, and that the board is
// never told about the sheet. It deliberately does not claim to have measured
// anything — happy-dom has no layout engine, so the reflow itself is proven by
// the `game-debug-sheet` surface in `scripts/ui-gate/surfaces.ts`, which
// measures the wrapper's box with the sheet closed and open at all five
// viewports.
import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

import DebugBoardArea from "../debug-board-area";
import DebugSheetProvider from "../debug-sheet-provider";
import {
    DEBUG_SHEET_DESKTOP_WIDTH_PX,
    DEBUG_SHEET_PUSH_CLASS,
} from "../debug-sheet-metrics";

function area() {
    return document.querySelector("[data-board-area]") as HTMLElement;
}

function renderArea(enabled = true) {
    return render(
        <DebugSheetProvider enabled={enabled}>
            <DebugBoardArea>
                <div data-testid="board" />
            </DebugBoardArea>
        </DebugSheetProvider>
    );
}

beforeEach(() => {
    cleanup();
    localStorage.clear();
});

describe("DebugBoardArea — the push (issue #3493)", () => {
    it("reserves nothing while the sheet is closed", () => {
        renderArea();
        expect(area().className).not.toContain(DEBUG_SHEET_PUSH_CLASS);
    });

    it("reserves the sheet's width once it is open", () => {
        renderArea();
        fireEvent.keyDown(window, { key: "`" });
        expect(area().className).toContain(DEBUG_SHEET_PUSH_CLASS);
    });

    it("gives the space back on close — the board reflows both ways", () => {
        renderArea();
        fireEvent.keyDown(window, { key: "`" });
        fireEvent.keyDown(window, { key: "`" });
        expect(area().className).not.toContain(DEBUG_SHEET_PUSH_CLASS);
    });

    it("reserves it ONLY at `lg` and wider — below that the sheet still overlays", () => {
        // The whole of the open-state difference is behind the `lg:` variant,
        // so a phone's board width cannot depend on the flag at all. An
        // unprefixed margin here would silently narrow the phone board by
        // 480px of a 390px viewport.
        renderArea();
        fireEvent.keyDown(window, { key: "`" });
        const pushClasses = area()
            .className.split(/\s+/)
            .filter((c) => c.includes("ml-["));
        expect(pushClasses.length).toBeGreaterThan(0);
        for (const cls of pushClasses) expect(cls.startsWith("lg:")).toBe(true);
    });

    it("reserves exactly the width the sheet takes", () => {
        // One number in one module (`debug-sheet-metrics.ts`): a too-small
        // margin puts the sheet back over the board, a too-large one leaves a
        // dead gutter, and neither is visible in any offline suite.
        expect(DEBUG_SHEET_PUSH_CLASS).toContain(
            `[${DEBUG_SHEET_DESKTOP_WIDTH_PX}px]`
        );
    });

    it("keeps the persisted flag when `enabled` resolves AFTER the first render", () => {
        // `enabled` is `import.meta.env.DEV || canUseDebugSheet(currentUser)`,
        // and `currentUser` is a Convex query — `undefined` until it resolves.
        // In a production build a reloaded board therefore renders once with
        // `enabled: false`, and gating the state INITIALIZER on that dropped a
        // tester's persisted-open sheet permanently (PR #3505 review).
        localStorage.setItem("tolaria:debugSheetOpen", "1");
        const view = render(
            <DebugSheetProvider enabled={false}>
                <DebugBoardArea>
                    <div data-testid="board" />
                </DebugBoardArea>
            </DebugSheetProvider>
        );
        expect(area().className).not.toContain(DEBUG_SHEET_PUSH_CLASS);
        view.rerender(
            <DebugSheetProvider enabled>
                <DebugBoardArea>
                    <div data-testid="board" />
                </DebugBoardArea>
            </DebugSheetProvider>
        );
        expect(area().className).toContain(DEBUG_SHEET_PUSH_CLASS);
    });

    it("does not push for a viewer who cannot open the sheet", () => {
        // The open flag is PERSISTED per device, so a tester session on this
        // browser would otherwise reach across to a regular player's board.
        localStorage.setItem("tolaria:debugSheetOpen", "1");
        renderArea(false);
        expect(area().className).not.toContain(DEBUG_SHEET_PUSH_CLASS);
    });
});
