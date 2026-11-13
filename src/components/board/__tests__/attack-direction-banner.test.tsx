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
import type { CardInstance } from "~/types/game";

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

    it("renders the full longest prompt (planeswalker target hint) without truncation, and never mentions 'phase pod'", () => {
        // Longest of the concatenated strings in this banner — the worst-case
        // wrap candidate at a 390px viewport.
        const { container } = render(
            <AttackDirectionBanner planeswalkerPresent={true} />
        );
        expect(container.textContent).toContain(
            "You then choose whether they attack the player or a planeswalker."
        );
        expect(container.textContent).not.toMatch(/phase pod/i);
        expect(container.textContent).not.toMatch(/click/i);
    });

    it("asks what the awaiting creatures attack, naming the nameplate and planeswalkers", () => {
        const { container } = render(
            <AttackDirectionBanner planeswalkerPresent choosingTarget />
        );
        expect(container.textContent).toContain("What do they attack?");
        expect(container.textContent).toMatch(/planeswalker or the opponent/);
        expect(container.textContent).not.toMatch(/click/i);
    });
});

// Issue #9500 — the reporter could not tell WHICH creature was choosing its
// attack target during "Attack with all" and read it as a freeze. The banner
// names it, gives its place in the walk and who comes next.
describe("AttackDirectionBanner names the creature choosing (issue #9500)", () => {
    const chooserCard = {
        id: "a1",
        card: { id: "f8ac5006-91bd-4803-93da-f87cf196dd2f" },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        types: ["Creature"],
        subtypes: [],
    } as unknown as CardInstance;

    it("walk: name, n of m, and the remaining attackers", () => {
        render(
            <AttackDirectionBanner
                planeswalkerPresent
                choosingTarget
                chooser={{
                    card: chooserCard,
                    names: ["Serra Angel"],
                    position: 2,
                    total: 3,
                    nextNames: ["Grizzly Bears"],
                }}
            />
        );
        const line = screen.getByTestId("attack-chooser").textContent ?? "";
        expect(line).toContain("Serra Angel");
        expect(line).toContain("2 of 3");
        expect(screen.getByText(/Then: Grizzly Bears\./)).toBeTruthy();
    });

    it("walk: the last attacker says so", () => {
        render(
            <AttackDirectionBanner
                planeswalkerPresent
                choosingTarget
                chooser={{
                    card: chooserCard,
                    names: ["Serra Angel"],
                    position: 3,
                    total: 3,
                    nextNames: [],
                }}
            />
        );
        expect(screen.getByText(/Last one\./)).toBeTruthy();
    });

    it("no chooser keeps the generic copy", () => {
        const { container } = render(
            <AttackDirectionBanner planeswalkerPresent choosingTarget />
        );
        expect(container.textContent).toContain("What do they attack?");
    });
});
