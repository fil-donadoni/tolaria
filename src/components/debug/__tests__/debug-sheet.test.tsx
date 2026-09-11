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

const GAME = "game1" as Id<"games">;

function renderSheet(vsAi = false) {
    return render(<DebugSheet gameId={GAME} playerId="me" vsAi={vsAi} />);
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
