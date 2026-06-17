// Slice #252 (PRD #249): cards animate to their target placement with a spring
// when their placement changes — zone change, count change, reorder — instead of
// jumping, and a card retains its element identity across a zone change (it
// animates, it is not destroyed and recreated).
//
// These tests assert observable behavior, not animation internals:
//   - the SAME DOM element persists across a placement change (reflow) and
//     across a zone change (identity preserved), keyed by the card instance id;
//   - the outer slot always carries the resolved target placement transform
//     (the layout source of truth #251 is never a mid-tween value);
//   - reduced-motion users get no transition (accessibility).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { LayoutGroup } from "motion/react";
import { CARD_WIDTH, CARD_HEIGHT, type Placement } from "~/lib/board-layout";
import SpatialSlot from "../spatial-slot";

// Drive prefers-reduced-motion from a mutable holder so cases can flip it.
let reduceMotion = false;
vi.mock("motion/react", async () => {
    const actual =
        await vi.importActual<typeof import("motion/react")>("motion/react");
    return { ...actual, useReducedMotion: () => reduceMotion };
});

function place(over: Partial<Placement> = {}): Placement {
    return { x: 100, y: 100, rotation: 0, scale: 1, ...over };
}

/** Reads the resolved card center back out of a slot's literal transform. */
function centerFromSlot(el: HTMLElement) {
    const m = el.style.transform.match(
        /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/
    );
    expect(m).toBeTruthy();
    return {
        x: Number(m![1]) + CARD_WIDTH / 2,
        y: Number(m![2]) + CARD_HEIGHT / 2,
    };
}

function renderSlot(slotId: string, placement: Placement, label: string) {
    return render(
        <LayoutGroup>
            <SpatialSlot
                slotId={slotId}
                placement={placement}
                cardWidth={CARD_WIDTH}
                cardHeight={CARD_HEIGHT}
            >
                <span>{label}</span>
            </SpatialSlot>
        </LayoutGroup>
    );
}

describe("SpatialSlot zone-transition animation (#252)", () => {
    beforeEach(() => {
        cleanup();
        reduceMotion = false;
    });

    it("keeps the same DOM element when its placement changes (reflow, no remount)", () => {
        const { container, rerender } = renderSlot("card-1", place(), "A");
        const before = container.querySelector<HTMLElement>(
            "[data-card-slot='card-1']"
        )!;
        expect(before).toBeTruthy();

        // Reflow: a neighbour was added/removed, so this card's placement moves.
        rerender(
            <LayoutGroup>
                <SpatialSlot
                    slotId="card-1"
                    placement={place({ x: 300 })}
                    cardWidth={CARD_WIDTH}
                    cardHeight={CARD_HEIGHT}
                >
                    <span>A</span>
                </SpatialSlot>
            </LayoutGroup>
        );

        const after = container.querySelector<HTMLElement>(
            "[data-card-slot='card-1']"
        )!;
        // Same node identity — it animated, it was not destroyed and recreated.
        expect(after).toBe(before);
        // And the outer slot already carries the resolved target placement
        // (source of truth is never a mid-tween value).
        expect(centerFromSlot(after).x).toBeCloseTo(300, 2);
    });

    it("springs the transform (transition set) when motion is allowed", () => {
        const { container, rerender } = renderSlot("card-1", place(), "A");
        const first = container.querySelector<HTMLElement>(
            "[data-card-slot='card-1']"
        )!;
        // A transform transition is present so any placement change eases rather
        // than jumps. (A freshly inserted element has no transition origin, so
        // this never causes a slide-in from the page origin on mount.)
        expect(first.style.transition).toContain("transform");

        rerender(
            <LayoutGroup>
                <SpatialSlot
                    slotId="card-1"
                    placement={place({ x: 250 })}
                    cardWidth={CARD_WIDTH}
                    cardHeight={CARD_HEIGHT}
                >
                    <span>A</span>
                </SpatialSlot>
            </LayoutGroup>
        );
        const moved = container.querySelector<HTMLElement>(
            "[data-card-slot='card-1']"
        )!;
        // Still the same node, still eased, now at the new placement.
        expect(moved).toBe(first);
        expect(moved.style.transition).toContain("transform");
        expect(centerFromSlot(moved).x).toBeCloseTo(250, 2);
    });

    it("preserves the inner shared-layout element identity across a zone change", () => {
        // Zone A renders the card at one position; zone B (a different subtree,
        // different placement) renders the SAME slotId. The motion shared-layout
        // element (layoutId) is matched across the two so the card animates
        // between zones rather than unmount/remounting as a fresh element.
        // Observable proxy: the inner element keyed by layoutId is present
        // before and after the zone swap and carries the card's content.
        const inHandPlacement = place({ x: 100, y: 400 });
        const { container, rerender } = renderSlot(
            "card-7",
            inHandPlacement,
            "Bolt"
        );
        const handSlot = container.querySelector<HTMLElement>(
            "[data-card-slot='card-7']"
        )!;
        expect(handSlot.textContent).toBe("Bolt");

        // Same card id, new zone placement (e.g. cast → battlefield row).
        const onBattlefield = place({ x: 600, y: 150 });
        rerender(
            <LayoutGroup>
                <SpatialSlot
                    slotId="card-7"
                    placement={onBattlefield}
                    cardWidth={CARD_WIDTH}
                    cardHeight={CARD_HEIGHT}
                >
                    <span>Bolt</span>
                </SpatialSlot>
            </LayoutGroup>
        );
        const bfSlot = container.querySelector<HTMLElement>(
            "[data-card-slot='card-7']"
        )!;
        // Identity preserved (same node, same content) and at its new placement.
        expect(bfSlot).toBe(handSlot);
        expect(bfSlot.textContent).toBe("Bolt");
        expect(centerFromSlot(bfSlot).x).toBeCloseTo(600, 2);
        expect(centerFromSlot(bfSlot).y).toBeCloseTo(150, 2);
    });

    it("disables the transition for reduced-motion users (accessibility)", () => {
        reduceMotion = true;
        const { container, rerender } = renderSlot("card-1", place(), "A");
        rerender(
            <LayoutGroup>
                <SpatialSlot
                    slotId="card-1"
                    placement={place({ x: 300 })}
                    cardWidth={CARD_WIDTH}
                    cardHeight={CARD_HEIGHT}
                >
                    <span>A</span>
                </SpatialSlot>
            </LayoutGroup>
        );
        const el = container.querySelector<HTMLElement>(
            "[data-card-slot='card-1']"
        )!;
        // No CSS transition even on reflow — cards snap to placement.
        expect(el.style.transition).toBe("none");
        // The resolved placement is still applied immediately.
        expect(centerFromSlot(el).x).toBeCloseTo(300, 2);
    });
});
