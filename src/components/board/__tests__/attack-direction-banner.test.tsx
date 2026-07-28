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

    it("names the actual Confirm Attackers button instead", () => {
        render(<AttackDirectionBanner planeswalkerPresent={false} />);
        expect(
            screen.getByText(/Click Confirm Attackers when done\./)
        ).toBeTruthy();
    });

    it("renders the full longest prompt (planeswalker retarget hint) without truncation, and never mentions 'phase pod'", () => {
        // Longest of the three concatenated strings in this banner (~135
        // chars) — the worst-case wrap candidate at a 390px viewport.
        const { container } = render(
            <AttackDirectionBanner planeswalkerPresent={true} />
        );
        expect(container.textContent).toContain(
            "Click an enemy planeswalker to direct your most recent attacker at it — click the attacker again to send it back to the player."
        );
        expect(container.textContent).not.toMatch(/phase pod/i);
        // Wrapping text, never a single unbreakable line or a clipped
        // ellipsis — the banner's own text content is never marked
        // `whitespace-nowrap` or `truncate` (Tailwind's text-overflow
        // ellipsis class), either of which would visually break/clip long
        // copy at a narrow viewport instead of letting it wrap.
        const textNode = container.querySelector("span.font-semibold")
            ?.parentElement as HTMLElement;
        expect(textNode.className).not.toMatch(/whitespace-nowrap/);
        expect(textNode.className).not.toMatch(/\btruncate\b/);
    });
});

describe("AttackDirectionBanner mobile width (390px, issue #1762)", () => {
    it("keeps a width cap so long copy wraps rather than overflowing a 390px viewport", () => {
        // jsdom performs no real CSS layout (no box measurements), so this
        // asserts the STRUCTURAL contract instead: the banner (and its
        // combat-panels.tsx wrapper — see board_center positioning notes)
        // declares an explicit max-width rather than sizing to its
        // (unbounded, planeswalker-hint-inclusive) content.
        const { container } = render(
            <div style={{ width: "390px" }}>
                <AttackDirectionBanner planeswalkerPresent={true} />
            </div>
        );
        const banner = container.querySelector('[data-slot="banner"]');
        expect(banner).not.toBeNull();
        expect(banner!.className).toMatch(/max-w-/);
    });
});
