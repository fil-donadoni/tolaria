// The AI decision box positions NOTHING (issue #1764, then #3403). It used to
// anchor itself (`fixed`, `top-1/2`), which is how a tall Debug panel grew
// underneath it and the two overlapped; the left rail took the anchoring over,
// and the left `DebugSheet` inherited it. The box must therefore stay a plain
// in-flow block that fills whatever container it is given — a 400px-wide phone
// sheet included, which is what the old fixed `w-72` could not do.
//
// What it DOES own is section order and the open body's max-height
// (issue #3492) — the two things a tester's reading of a bot play depends on,
// and the two things no layout-free suite can see unless they are asserted
// here. `bun run check:ui` measures the resulting geometry in a real browser;
// this file guards the contract that produces it.
import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { clearAiDecisions, recordAiDecision } from "~/lib/ai/trace-store";

import AiDecisionTraceBox from "../ai-decision-trace-box";

beforeEach(() => {
    cleanup();
    clearAiDecisions();
});

/** The open body — the node that carries the height contract. */
function body(container: HTMLElement): HTMLElement {
    const el = container.querySelector<HTMLElement>("[data-ai-trace-body]");
    if (!el) throw new Error("the box rendered no open body");
    return el;
}

/** The `vh` figure a `max-h-[Nvh]` utility carries, for the given variant
 *  prefix (`""` = the unprefixed base). Reading the NUMBER rather than the
 *  literal class string is what lets the assertion say "taller", which is the
 *  contract, instead of "spelled this way". */
function maxHeightVh(el: HTMLElement, variant: string): number {
    const match = new RegExp(`(?:^| )${variant}max-h-\\[(\\d+)vh\\]`).exec(
        el.className
    );
    if (!match) {
        throw new Error(
            `no \`${variant}max-h-[Nvh]\` on the open body: ${el.className}`
        );
    }
    return Number(match[1]);
}

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

    it("renders the decision RING above the outcome log (issue #3492)", () => {
        // The outcome log is non-empty in the HEALTHY case, which is exactly
        // when the old order buried the ring — so the fixture has to give it a
        // row, or the assertion passes on a log that never rendered.
        recordAiDecision({
            outcome: "move",
            expectedKind: "priority",
            phase: "PRECOMBAT_MAIN",
            seq: 1,
            moveKind: "pass",
        });
        const { container } = render(<AiDecisionTraceBox />);
        const text = body(container).textContent ?? "";
        const ring = text.indexOf("AI · last decisions");
        const log = text.indexOf("Bot decisions");
        expect(ring).toBeGreaterThanOrEqual(0);
        expect(log).toBeGreaterThanOrEqual(0);
        expect(ring).toBeLessThan(log);
    });

    it("opens taller from `lg` up than it does on a phone", () => {
        const { container } = render(<AiDecisionTraceBox />);
        const el = body(container);
        expect(maxHeightVh(el, "lg:")).toBeGreaterThan(maxHeightVh(el, ""));
    });

    it("lifts the height at `lg`, not `md` — the landscape phone is 844px WIDE", () => {
        // 844x390 clears `md` (768px) and is the SHORTEST viewport in the
        // matrix (ADR 0101). An `md` lift would spend its 390px of height on
        // the one screen that has none to spare, pushing the sheet's action
        // row out of reach.
        const el = body(render(<AiDecisionTraceBox />).container);
        expect(el.className).not.toMatch(/(?:^| )md:max-h-/);
        expect(el.className).not.toMatch(/(?:^| )sm:max-h-/);
    });
});
