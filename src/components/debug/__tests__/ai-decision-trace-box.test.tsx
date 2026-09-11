// The AI decision box positions NOTHING (issue #1764, then #3403). It used to
// anchor itself (`fixed`, `top-1/2`), which is how a tall Debug panel grew
// underneath it and the two overlapped; the left rail took the anchoring over,
// and the left `DebugSheet` inherited it. The box must therefore stay a plain
// in-flow block that fills whatever container it is given — a 400px-wide phone
// sheet included, which is what the old fixed `w-72` could not do.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("../ai-decision-trace", () => ({ default: () => null }));

import AiDecisionTraceBox from "../ai-decision-trace-box";

beforeEach(() => cleanup());

describe("AiDecisionTraceBox (debug-sheet child)", () => {
    it("does not anchor itself — the sheet owns the positioning", () => {
        const { container } = render(<AiDecisionTraceBox />);
        const root = container.firstElementChild as HTMLElement;
        expect(root.className).not.toContain("fixed");
        expect(root.className).not.toContain("top-1/2");
        expect(root.className).not.toContain("left-");
    });

    it("fills its container instead of pinning a width the sheet cannot honour", () => {
        const { container } = render(<AiDecisionTraceBox />);
        const root = container.firstElementChild as HTMLElement;
        expect(root.className).toContain("w-full");
        expect(root.className).toContain("min-w-0");
        expect(root.className).not.toContain("w-72");
    });
});
