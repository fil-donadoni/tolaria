// The touch drag ghost (PRD #2405, issue #2583) — structural contract only.
//
// happy-dom has no layout and evaluates no stylesheet, so nothing here can
// assert that the ring is PAINTED. What it can assert is the one structural
// property that decides whether it ever could be: the `.card-ring` recipe is a
// `::after` pseudo-element, and a replaced element (`<img>`) generates no
// pseudo-element box at all. Issue #2724 shipped the recipe ON the `<img>` and
// deleted the ring silently — `border-radius` still applied, so the corner
// looked right and every existing test stayed green.
//
// `src/__tests__/card-ring-replaced-elements.test.ts` catches the same class of
// error catalogue-wide, by scanning source. This file pins the SHIPPED shape
// of the one component the regression landed on, through a real render.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import DragGhost from "../drag-ghost";
import type { GestureDrag } from "~/lib/gesture/useGestureEngine";

const drag: GestureDrag = { key: "bolt", x: 120, y: 300, over: null };

afterEach(cleanup);

describe("DragGhost — the ring's box (issue #2724)", () => {
    it("paints its ring on a non-replaced wrapper, never on the <img>", () => {
        const { container } = render(<DragGhost drag={drag} cardId="bolt" />);

        const ringed = container.querySelectorAll("[class*='card-ring']");
        expect(ringed.length, "the ghost draws a ring at all").toBeGreaterThan(
            0
        );
        for (const el of ringed)
            expect(
                el.tagName,
                `a ${el.tagName} generates no ::after box, so this ring is never painted`
            ).not.toBe("IMG");
    });

    it("still carries the card's own proportional corner on the image", () => {
        // The ui-gate probe (`cardsSquare`) measures the radius on the card's
        // own box chain. When the recipe moved off the `<img>` the corner had
        // to move WITH it, or the fix for the ring would have created a square
        // ghost.
        const { container } = render(<DragGhost drag={drag} cardId="bolt" />);
        const img = container.querySelector("img");
        expect(img, "the ghost renders a card image").not.toBeNull();
        expect(img!.className).toContain("card-corner");
    });

    it("keeps the handle and the pointer-transparency on the ring's own box", () => {
        // `useGestureEngine` finds the ghost by `[data-drag-ghost]` and the
        // drop resolution runs `elementFromPoint` at the finger, which the
        // ghost sits exactly on top of — both properties belong to the
        // outermost box, which is the one that just changed.
        const { container } = render(<DragGhost drag={drag} cardId="bolt" />);
        const ghost = container.querySelector("[data-drag-ghost='bolt']");
        expect(ghost).not.toBeNull();
        expect(ghost!.className).toContain("card-ring");
        expect(ghost!.className).toContain("pointer-events-none");
    });
});
