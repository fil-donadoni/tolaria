// The debug area as a LEFT SHEET (issue #3403, PRD #3397).
//
// What this pins is the shell, not the contents: the slim edge toggle and where
// it sits, the keyboard shortcut and the one place it must NOT fire, the
// per-device persistence, and the fact that the AI decision box rides along
// only for a vs-AI game. The three actions inside are pinned by
// `debug-panel-actions.test.tsx`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";

vi.mock("../debug-panel", () => ({
    default: () => <div data-testid="debug-actions" />,
}));
vi.mock("../ai-decision-trace-box", () => ({
    default: () => <div data-testid="ai-trace" />,
}));

const DebugSheet = (await import("../debug-sheet")).default;
const DebugSheetProvider = (await import("../debug-sheet-provider")).default;

const GAME = "game1" as Id<"games">;

// The open flag lives in the provider since issue #3493 (the board area is a
// SIBLING of the sheet and has to react to it), so every render here mounts
// the pair the route mounts.
function renderSheet(vsAi = false) {
    return render(
        <DebugSheetProvider enabled>
            <DebugSheet gameId={GAME} playerId="me" vsAi={vsAi} />
        </DebugSheetProvider>
    );
}

function toggle() {
    return document.querySelector(
        "[data-debug-sheet-toggle]"
    ) as HTMLButtonElement;
}

function sheet() {
    return document.querySelector("[data-debug-sheet]");
}

beforeEach(() => {
    cleanup();
    localStorage.clear();
});

describe("DebugSheet — edge toggle (issue #3403)", () => {
    it("renders a slim left-edge tab and nothing else while closed", () => {
        renderSheet();
        expect(toggle()).toBeTruthy();
        expect(sheet()).toBeFalsy();
        expect(screen.queryByTestId("debug-actions")).toBeNull();
    });

    it("is pinned to the left edge, clear of the portrait controller bar", () => {
        renderSheet();
        const cls = toggle().className;
        expect(cls).toContain("left-0");
        // The bar's MEASURED height (#1759/#1764), never a hard-coded inset:
        // the command row wraps and a fixed one lets the grown bar cover this.
        expect(cls).toContain("var(--controller-bar-h");
        expect(cls).not.toContain("bottom-28");
        // Slim: a tab, not a panel. `w-5` is 20px.
        expect(cls).toContain("w-5");
    });

    it("sits above the board but below the sheet it opens", () => {
        renderSheet();
        const cls = toggle().className;
        expect(cls).toContain("z-dev-overlay");
        expect(cls).not.toContain("z-sheet");
        expect(cls).not.toContain("z-modal");
    });

    it("opens and closes the sheet on click", () => {
        renderSheet();
        fireEvent.click(toggle());
        expect(sheet()).toBeTruthy();
        expect(screen.getByTestId("debug-actions")).toBeTruthy();
        fireEvent.click(toggle());
        expect(sheet()).toBeFalsy();
    });
});

describe("DebugSheet — keyboard shortcut (issue #3403)", () => {
    it("toggles on the shortcut key", () => {
        renderSheet();
        fireEvent.keyDown(window, { key: "`" });
        expect(sheet()).toBeTruthy();
        fireEvent.keyDown(window, { key: "`" });
        expect(sheet()).toBeFalsy();
    });

    it("does NOT fire while the user is typing — the scenario editor is all text fields", () => {
        renderSheet();
        const field = document.createElement("input");
        document.body.appendChild(field);
        fireEvent.keyDown(field, { key: "`", bubbles: true });
        expect(sheet()).toBeFalsy();
        field.remove();
    });

    it("ignores OS key-repeat — a held key is one decision, not a flicker", () => {
        renderSheet();
        fireEvent.keyDown(window, { key: "`" });
        expect(sheet()).toBeTruthy();
        for (let i = 0; i < 5; i++) {
            fireEvent.keyDown(window, { key: "`", repeat: true });
        }
        expect(sheet()).toBeTruthy();
    });

    it("leaves a modified chord alone so browser/OS shortcuts still work", () => {
        renderSheet();
        fireEvent.keyDown(window, { key: "`", metaKey: true });
        expect(sheet()).toBeFalsy();
    });
});

describe("DebugSheet — per-device persistence (issue #3403)", () => {
    it("remembers an open sheet across a reload", () => {
        const first = renderSheet();
        fireEvent.click(toggle());
        expect(sheet()).toBeTruthy();
        first.unmount();

        renderSheet();
        expect(sheet()).toBeTruthy();
    });

    it("remembers a closed sheet across a reload", () => {
        const first = renderSheet();
        fireEvent.click(toggle());
        fireEvent.click(toggle());
        first.unmount();

        renderSheet();
        expect(sheet()).toBeFalsy();
    });
});

describe("DebugSheet — desktop width (issue #3493)", () => {
    it("widens to the shared desktop width at `lg`, keeping the phone width below it", async () => {
        const { DEBUG_SHEET_DESKTOP_WIDTH_PX } =
            await import("../debug-sheet-metrics");
        renderSheet();
        fireEvent.click(toggle());
        const cls = (sheet() as HTMLElement).className;
        // Below `lg` nothing changed: the overlay sheet still takes 88% of a
        // phone viewport.
        expect(cls).toContain("w-[88%]");
        // At `lg` it is the width the board area gives up — one number, one
        // module, so the two cannot drift (`debug-sheet-metrics.ts`).
        //
        // `data-[side=left]:` on BOTH overrides is the whole point (PR #3505
        // review): the primitive's `data-[side=left]:w-3/4` and
        // `data-[side=left]:sm:max-w-sm` are (0,2,0) selectors, so a bare
        // `lg:` utility at (0,1,0) loses to them at every width and the sheet
        // stays 384px while the board reserves 480. Same shape, `lg` after
        // `sm`, this one wins.
        expect(cls).toContain(
            `data-[side=left]:lg:w-[${DEBUG_SHEET_DESKTOP_WIDTH_PX}px]`
        );
        expect(cls).toContain(
            `data-[side=left]:lg:max-w-[${DEBUG_SHEET_DESKTOP_WIDTH_PX}px]`
        );
        // The specificity claim itself, not just the strings: every desktop
        // width override must carry the attribute qualifier the rule it beats
        // carries. A future `lg:w-[…]` added without it re-opens the gutter.
        for (const token of cls
            .split(/\s+/)
            .filter((c) => /(?:^|:)lg:(?:max-)?w-\[/.test(c))) {
            expect(token.startsWith("data-[side=left]:")).toBe(true);
        }
    });
});

describe("DebugSheet — no provider (issue #3493)", () => {
    it("renders nothing at all — there is no second, private copy of the flag", () => {
        render(<DebugSheet gameId={GAME} playerId="me" vsAi={false} />);
        expect(toggle()).toBeFalsy();
        expect(sheet()).toBeFalsy();
    });
});

describe("DebugSheet — contents (issue #3403)", () => {
    it("carries the AI decision box in a vs-AI game", () => {
        renderSheet(true);
        fireEvent.click(toggle());
        expect(screen.getByTestId("ai-trace")).toBeTruthy();
    });

    it("omits it everywhere else — there is no trace to show", () => {
        renderSheet(false);
        fireEvent.click(toggle());
        expect(screen.queryByTestId("ai-trace")).toBeNull();
    });
});
