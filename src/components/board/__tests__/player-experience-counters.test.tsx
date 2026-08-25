import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import PlayerExperienceCounters from "../player-experience-counters";

// Experience counters badge (CR 122.1 — a counter on a PLAYER) — renders only
// when count > 0, shows the count, and uses the semantic accent token (ADR
// 0007). A player resource that lives in state but never reaches the board is
// the "passes its own tests, reads as done" failure mode, so this badge is part
// of the mechanic, not a follow-up (issue #1969).
describe("PlayerExperienceCounters (CR 122.1)", () => {
    it("renders nothing when count is zero", () => {
        const { container } = render(<PlayerExperienceCounters count={0} />);
        expect(container.firstChild).toBeNull();
    });

    it("renders nothing when count is undefined (absent = zero)", () => {
        const { container } = render(
            <PlayerExperienceCounters count={undefined} />
        );
        expect(container.firstChild).toBeNull();
    });

    it("renders the count and the experience glyph when count > 0", () => {
        const { container, getByText } = render(
            <PlayerExperienceCounters count={3} />
        );
        expect(getByText("3")).toBeTruthy();
        expect(container.querySelector("svg")).toBeTruthy();
        expect(container.querySelector("[aria-label]")).toBeTruthy();
    });

    it("labels a single counter in the singular", () => {
        const { getByTitle } = render(<PlayerExperienceCounters count={1} />);
        expect(getByTitle("1 experience counter")).toBeTruthy();
    });

    it("uses the semantic accent token, not a chromatic class", () => {
        const { container } = render(<PlayerExperienceCounters count={5} />);
        const badge = container.firstChild as HTMLElement;
        expect(badge.className).toContain("text-accent");
    });

    it("drops its own vertical margin in the compact nameplate row", () => {
        const { container } = render(
            <PlayerExperienceCounters count={2} compact />
        );
        const badge = container.firstChild as HTMLElement;
        expect(badge.className).not.toContain("mt-0.5");
    });
});
