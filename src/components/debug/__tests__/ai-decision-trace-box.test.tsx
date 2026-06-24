// Play-area layout rule: the AI-decision trace box is a LEFT-side dev overlay
// that floats over the left edge of the play area. It must be left-anchored
// (`left-*`) and must NOT reserve layout width or center over the play area —
// the left side never affects centering. (The Debug panel floats in the
// bottom-left corner with `bottom-4 left-3`; both are dev overlays that don't
// reserve width. The AI box sits at left-center, the Debug panel at
// bottom-left, so they never overlap.)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("../ai-decision-trace", () => ({ default: () => null }));

import AiDecisionTraceBox from "../ai-decision-trace-box";

beforeEach(() => cleanup());

describe("AiDecisionTraceBox left float (play-area layout rule)", () => {
    it("is left-anchored and does not center on the play area", () => {
        const { container } = render(<AiDecisionTraceBox />);
        const root = container.firstElementChild as HTMLElement;
        expect(root.className).toContain("left-3");
        // It floats — no right anchor, no play-area centering offset.
        expect(root.className).not.toContain("right-");
        expect(root.className).not.toContain("play-area-center-x");
    });
});
