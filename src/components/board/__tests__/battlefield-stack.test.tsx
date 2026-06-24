// Issue #623 (PRD #621) — the spatial board's permanent stack renders identical
// permanents as a horizontal fan with a fixed footprint.
//
// Asserts the contract (observable structure), not pixels:
//  - a fan renders one clickable member per stack member, for sizes 2..8,
//  - the ×N count badge shows the correct member count,
//  - every member is individually clickable (the composed renderMember node),
//  - hover-lift floats in an overlay: it changes only the hovered member's
//    transform/z, NEVER the resting `left` offsets of any member (footprint
//    stable — the hard rule).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { CardInstance } from "~/types/game";
import { stackFanOffset } from "~/lib/board-layout";
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

/** Inert member renderer: a clickable leaf carrying the member id, so the test
 *  exercises BattlefieldStack's composition + overlay math without the full
 *  BoardBattlefieldCard tree. */
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

describe("BattlefieldStack fan (#623)", () => {
    beforeEach(() => cleanup());

    it("renders a fan with one member per stack member for sizes 2..8", () => {
        for (let n = 2; n <= 8; n++) {
            cleanup();
            const { container } = render(
                <BattlefieldStack
                    members={makeMembers(n)}
                    renderMember={renderMember(() => {})}
                />
            );
            const leaves = container.querySelectorAll("[data-member-leaf]");
            expect(leaves.length).toBe(n);
            // It is marked as a permanent stack carrying its size.
            const root = container.querySelector("[data-permanent-stack]");
            expect(root?.getAttribute("data-stack-size")).toBe(String(n));
        }
    });

    it("shows a ×N count badge with the correct member count", () => {
        const { container, getByText } = render(
            <BattlefieldStack
                members={makeMembers(5)}
                renderMember={renderMember(() => {})}
            />
        );
        const badge = container.querySelector("[data-stack-count]");
        expect(badge).toBeTruthy();
        expect(getByText("×5")).toBeTruthy();
    });

    it("renders a lone member with no fan or badge for size 1", () => {
        const { container } = render(
            <BattlefieldStack
                members={makeMembers(1)}
                renderMember={renderMember(() => {})}
            />
        );
        expect(container.querySelector("[data-permanent-stack]")).toBeNull();
        expect(container.querySelector("[data-stack-count]")).toBeNull();
        expect(container.querySelectorAll("[data-member-leaf]").length).toBe(1);
    });

    it("makes every member individually clickable", () => {
        const onClick = vi.fn();
        const { container } = render(
            <BattlefieldStack
                members={makeMembers(4)}
                renderMember={renderMember(onClick)}
            />
        );
        const leaves =
            container.querySelectorAll<HTMLButtonElement>("[data-member-leaf]");
        leaves.forEach((leaf) => fireEvent.click(leaf));
        expect(onClick).toHaveBeenCalledTimes(4);
        expect(onClick).toHaveBeenNthCalledWith(1, "m0");
        expect(onClick).toHaveBeenNthCalledWith(4, "m3");
    });

    it("offsets members by the clamped fan reveal (fixed footprint base)", () => {
        const n = 4;
        const { container } = render(
            <BattlefieldStack
                members={makeMembers(n)}
                renderMember={renderMember(() => {})}
            />
        );
        const offset = stackFanOffset(n);
        const members = container.querySelectorAll<HTMLElement>(
            "[data-stack-member]"
        );
        members.forEach((m, i) => {
            expect(m.style.left).toBe(`${i * offset}px`);
        });
    });

    it("hover-lift NEVER changes any member's layout box (footprint stable)", () => {
        const n = 5;
        const { container } = render(
            <BattlefieldStack
                members={makeMembers(n)}
                renderMember={renderMember(() => {})}
            />
        );
        const members = () =>
            Array.from(
                container.querySelectorAll<HTMLElement>("[data-stack-member]")
            );
        const restingLefts = members().map((m) => m.style.left);

        // Hover the middle member: it lifts (transform + high z), nothing else
        // moves. The lift is an OVERLAY (transform only) — the `left` offsets
        // that define each member's footprint are untouched for ALL members.
        const middle = members()[2];
        fireEvent.pointerEnter(middle);

        const liftedLefts = members().map((m) => m.style.left);
        expect(liftedLefts).toEqual(restingLefts);

        // The hovered member alone gains the lift transform + a top z-index.
        expect(middle.style.transform).toContain("translateY(-16px)");
        expect(Number(middle.style.zIndex)).toBeGreaterThan(50);
        // A non-hovered member keeps its resting (no-lift) transform.
        const other = members()[0];
        expect(other.style.transform || "").not.toContain("translateY");

        // Leaving clears the lift; footprint still unchanged.
        fireEvent.pointerLeave(middle);
        expect(members().map((m) => m.style.left)).toEqual(restingLefts);
        expect(members()[2].style.transform || "").not.toContain("translateY");
    });
});
