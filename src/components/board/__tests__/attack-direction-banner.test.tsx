// Declare-attackers guidance banner (issue #1762): the copy used to close
// with "Confirm in the phase pod when done." — a reference to the desktop
// right-edge controller pod that means nothing in the portrait bottom-bar
// layout (#331/#1759). There is a single string set for both layouts, so the
// wording must make sense either way; it now names the actual button
// ("Confirm Attackers"), which both the desktop pod and the mobile bottom
// bar render identically (`useControllerActions`).
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import AttackDirectionBanner from "../attack-direction-banner";

afterEach(cleanup);

describe("AttackDirectionBanner wording (issue #1762)", () => {
    it("never references the desktop-only 'phase pod'", () => {
        const { container } = render(
            <AttackDirectionBanner planeswalkerPresent={false} />
        );
        expect(container.textContent).not.toMatch(/phase pod/i);
    });

    it("names the actual Confirm Attackers button instead, with layout-neutral wording", () => {
        render(<AttackDirectionBanner planeswalkerPresent={false} />);
        // Issue #1762 review finding 6 — "Click ... when done" assumes a
        // mouse; this banner also renders on a touch/portrait board where
        // "click" reads wrong. No "Click" anywhere in the copy.
        expect(screen.getByText(/Confirm Attackers when done\./)).toBeTruthy();
        expect(screen.queryByText(/Click/)).toBeNull();
    });

    it("renders the full longest prompt (planeswalker retarget hint) without truncation, and never mentions 'phase pod'", () => {
        // Longest of the three concatenated strings in this banner (~135
        // chars) — the worst-case wrap candidate at a 390px viewport.
        const { container } = render(
            <AttackDirectionBanner planeswalkerPresent={true} />
        );
        expect(container.textContent).toContain(
            "Select an enemy planeswalker to direct your most recent attacker at it — select the attacker again to send it back to the player."
        );
        expect(container.textContent).not.toMatch(/phase pod/i);
        expect(container.textContent).not.toMatch(/click/i);
    });
});
