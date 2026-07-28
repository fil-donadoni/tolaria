// Play-area layout rule: every DEV overlay lives in ONE left rail
// (`DevPanelRail`) that floats over the left edge of the play area. The rail
// must be left-anchored (`left-*`) and must NOT reserve layout width or center
// over the play area — the left side never affects centering.
//
// The rail is also the anti-overlap invariant: the AI-decision trace box and
// the Debug panel used to anchor themselves independently (`top-1/2` and
// `bottom-4`), so a tall Debug panel grew straight underneath the trace box.
// Neither may position itself any more — the rail stacks them in a column.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("../ai-decision-trace", () => ({ default: () => null }));

import AiDecisionTraceBox from "../ai-decision-trace-box";
import DevPanelRail from "../dev-panel-rail";

beforeEach(() => cleanup());

describe("DevPanelRail left float (play-area layout rule)", () => {
    it("is left-anchored and does not center on the play area", () => {
        const { container } = render(<DevPanelRail>x</DevPanelRail>);
        const root = container.firstElementChild as HTMLElement;
        expect(root.className).toContain("left-3");
        // It floats — no right anchor, no play-area centering offset.
        expect(root.className).not.toContain("right-");
        expect(root.className).not.toContain("play-area-center-x");
    });

    it("marks its subtree so the Debug panel treats a rail click as inside", () => {
        const { container } = render(<DevPanelRail>x</DevPanelRail>);
        const root = container.firstElementChild as HTMLElement;
        expect(root.hasAttribute("data-dev-rail")).toBe(true);
    });

    it("stacks its children in a column so they cannot overlap", () => {
        const { container } = render(<DevPanelRail>x</DevPanelRail>);
        const root = container.firstElementChild as HTMLElement;
        expect(root.className).toContain("flex-col");
    });
});

// #1764: dev overlays must never overlap gameplay controls on mobile. The
// rail used to reserve a hard-coded `bottom-28`, which sat correctly only for
// the bar's one-line state and let the grown (two-line) bar cover it; and it
// sat at `z-100`, painting OVER an open phase sheet (`z-sheet`, 50).
describe("DevPanelRail anchoring + z-order (issue #1764)", () => {
    it("anchors above the bar's MEASURED height, not a fixed inset", () => {
        const { container } = render(<DevPanelRail>x</DevPanelRail>);
        const root = container.firstElementChild as HTMLElement;
        expect(root.className).toContain("var(--controller-bar-h");
        expect(root.className).not.toContain("bottom-28");
    });

    it("sits below sheets/modals — above the board, not on top of a sheet", () => {
        const { container } = render(<DevPanelRail>x</DevPanelRail>);
        const root = container.firstElementChild as HTMLElement;
        expect(root.className).toContain("z-dev-overlay");
        expect(root.className).not.toContain("z-100");
        expect(root.className).not.toContain("z-sheet");
        expect(root.className).not.toContain("z-modal");
    });
});

describe("AiDecisionTraceBox (rail child)", () => {
    it("does not anchor itself — the rail owns the positioning", () => {
        const { container } = render(<AiDecisionTraceBox />);
        const root = container.firstElementChild as HTMLElement;
        expect(root.className).not.toContain("fixed");
        expect(root.className).not.toContain("top-1/2");
        expect(root.className).not.toContain("left-");
    });
});
