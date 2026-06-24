// Issue #624 (PRD #621) — large permanent stacks (>8) render as a tight
// depth-pile that expands into the full fan in an overlay on hover, without ever
// reflowing neighbouring permanents.
//
// Asserts the contract (observable structure), not pixels:
//  - a stack with >8 members renders the depth-pile (not a wide fan at rest),
//  - 8-or-fewer members still render the direct fan (#623 path untouched),
//  - the ×N badge reports the true member count,
//  - hovering the depth-pile expands it to the full fan (every member appears
//    and is individually clickable),
//  - the footprint is stable: the parent slot box never grows or moves when the
//    pile is hovered/expanded (the overlay floats, neighbours never reflow).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { CardInstance } from "~/types/game";
import { STACK_DEPTH_PILE_THRESHOLD, isDepthPile } from "~/lib/board-layout";
import BattlefieldStack from "../battlefield-stack";

function makeMembers(n: number): CardInstance[] {
    return Array.from({ length: n }, (_, i) => ({
        id: `m${i}`,
        card: { id: "forest-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        types: ["Land"],
    })) as CardInstance[];
}

/** Inert member renderer: a clickable leaf carrying the member id. */
function renderMember(onClick: (id: string) => void) {
    return (card: CardInstance) => (
        <button
            type="button"
            data-member-leaf={card.id}
            onClick={() => onClick(card.id)}
        >
            {card.id}
        </button>
    );
}

/** Wrap the stack in a fixed-size host so we can assert the host's box never
 *  changes when the pile is hovered — the footprint-stability hard rule. */
function renderInHost(members: CardInstance[], onClick = () => {}) {
    return render(
        <div
            data-host
            style={{ width: 120, height: 168, position: "relative" }}
        >
            <BattlefieldStack
                members={members}
                renderMember={renderMember(onClick)}
            />
        </div>
    );
}

describe("BattlefieldStack depth-pile threshold (#624)", () => {
    beforeEach(() => cleanup());

    it("renders a depth-pile (not a fan) strictly above the threshold", () => {
        const n = STACK_DEPTH_PILE_THRESHOLD + 1; // 9
        const { container } = renderInHost(makeMembers(n));
        expect(container.querySelector("[data-stack-pile]")).toBeTruthy();
        // At rest the collapsed pile is shown; no expanded fan overlay yet.
        expect(
            container.querySelector("[data-stack-pile-collapsed]")
        ).toBeTruthy();
        expect(
            container.querySelector("[data-stack-pile-expanded]")
        ).toBeNull();
    });

    it("renders the direct fan at and below the threshold (#623 untouched)", () => {
        for (const n of [2, 5, STACK_DEPTH_PILE_THRESHOLD]) {
            cleanup();
            const { container } = renderInHost(makeMembers(n));
            // A fanned stack root with no depth-pile marker.
            const root = container.querySelector("[data-permanent-stack]");
            expect(root).toBeTruthy();
            expect(root?.getAttribute("data-stack-pile")).toBeNull();
            expect(container.querySelector("[data-stack-pile]")).toBeNull();
        }
    });

    it("isDepthPile matches the >8 threshold exactly", () => {
        expect(isDepthPile(8)).toBe(false);
        expect(isDepthPile(9)).toBe(true);
        expect(isDepthPile(20)).toBe(true);
    });
});

describe("BattlefieldStack depth-pile badge + footprint (#624)", () => {
    beforeEach(() => cleanup());

    it("shows a ×N badge with the true member count at rest", () => {
        const n = 12;
        const { container, getByText } = renderInHost(makeMembers(n));
        expect(container.querySelector("[data-stack-count]")).toBeTruthy();
        expect(getByText(`×${n}`)).toBeTruthy();
    });

    it("hovering the pile expands it to the full fan with every member present", () => {
        const n = 11;
        const { container } = renderInHost(makeMembers(n));
        const pile = container.querySelector<HTMLElement>("[data-stack-pile]")!;

        // Before hover there is no expanded fan overlay.
        expect(
            container.querySelector("[data-stack-pile-expanded]")
        ).toBeNull();

        fireEvent.pointerEnter(pile);

        // The overlay-expanded fan is now mounted with one member per stack
        // member, each individually clickable.
        const overlay = container.querySelector<HTMLElement>(
            "[data-stack-pile-expanded]"
        )!;
        expect(overlay).toBeTruthy();
        const members = overlay.querySelectorAll("[data-stack-member]");
        expect(members.length).toBe(n);
        const leaves = overlay.querySelectorAll("[data-member-leaf]");
        expect(leaves.length).toBe(n);

        // Leaving collapses back to the resting pile.
        fireEvent.pointerLeave(pile);
        expect(
            container.querySelector("[data-stack-pile-expanded]")
        ).toBeNull();
    });

    it("every member is individually clickable once expanded", () => {
        const n = 10;
        const onClick = vi.fn();
        const { container } = renderInHost(makeMembers(n), () => {});
        // Re-render with the spy renderer via the overlay fan: hover, then click
        // each leaf in the expanded overlay.
        cleanup();
        const { container: c2 } = render(
            <div data-host style={{ width: 120, height: 168 }}>
                <BattlefieldStack
                    members={makeMembers(n)}
                    renderMember={renderMember(onClick)}
                />
            </div>
        );
        const pile = c2.querySelector<HTMLElement>("[data-stack-pile]")!;
        fireEvent.pointerEnter(pile);
        const overlay = c2.querySelector<HTMLElement>(
            "[data-stack-pile-expanded]"
        )!;
        const leaves =
            overlay.querySelectorAll<HTMLButtonElement>("[data-member-leaf]");
        leaves.forEach((leaf) => fireEvent.click(leaf));
        expect(onClick).toHaveBeenCalledTimes(n);
        // keep the first render referenced so the linter is happy
        expect(container).toBeTruthy();
    });

    it("hover/expand NEVER changes the host footprint (overlay floats — hard rule)", () => {
        const n = 14;
        const { container } = renderInHost(makeMembers(n));
        const host = container.querySelector<HTMLElement>("[data-host]")!;
        const pile = container.querySelector<HTMLElement>("[data-stack-pile]")!;

        // The host box (the reserved one-card slot) is fixed at 120×168. Hover
        // expands the fan into an absolute overlay — the host's inline size must
        // not change, and the wrapper stays absolutely positioned (overlay).
        const before = {
            width: host.style.width,
            height: host.style.height,
        };
        fireEvent.pointerEnter(pile);
        const overlay = container.querySelector<HTMLElement>(
            "[data-stack-pile-expanded]"
        )!;
        // The overlay is absolutely positioned (floats over neighbours) — it does
        // not participate in layout flow, so it cannot push the host or siblings.
        expect(overlay.className).toContain("absolute");
        expect(host.style.width).toBe(before.width);
        expect(host.style.height).toBe(before.height);

        fireEvent.pointerLeave(pile);
        expect(host.style.width).toBe(before.width);
        expect(host.style.height).toBe(before.height);
    });
});
