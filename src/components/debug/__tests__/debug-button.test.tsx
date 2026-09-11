// `DebugButton` forwards a className, and the forward has to WIN (issue #3403).
//
// The button's base recipe is `shrink-0 whitespace-nowrap`. That is right for a
// verb and wrong for a scenario label: inside the 293px-wide debug sheet a long
// label rendered a 523px-wide button and pushed its own ✎/× controls out of the
// row (measured in Chrome at 390x844 — 336 of 472 controls past the sheet's
// right edge, 0 after). The fix is `min-w-0 shrink truncate` on that one button,
// which only works if the override survives the merge — a plain string
// concatenation leaves `shrink-0` in the class list and the later `shrink` loses
// to it on specificity, so this pins the `cn` merge, not the prop's existence.
import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import DebugButton from "../debug-button";

/** Class TOKENS, not a substring scan: the base recipe also carries
 *  `[&_svg]:shrink-0`, a different variant that must survive the merge, and a
 *  naive `toContain("shrink-0")` reads that as the root class still being
 *  there. */
function tokens(el: Element): string[] {
    return [...el.classList];
}

beforeEach(() => cleanup());

describe("DebugButton className passthrough (issue #3403)", () => {
    it("keeps its own base classes when no override is given", () => {
        const { container } = render(
            <DebugButton onClick={() => {}}>Reset Game</DebugButton>
        );
        const button = container.querySelector("button")!;
        expect(tokens(button)).toContain("shrink-0");
        expect(tokens(button)).toContain("font-sans");
    });

    it("lets a caller override the base's shrink-0 so a label can truncate", () => {
        const { container } = render(
            <DebugButton
                onClick={() => {}}
                className="min-w-0 shrink justify-start truncate text-left"
            >
                A very long scenario label
            </DebugButton>
        );
        const button = container.querySelector("button")!;
        expect(tokens(button)).toContain("truncate");
        expect(tokens(button)).toContain("min-w-0");
        // The merge must have REMOVED the conflicting base class, not merely
        // appended after it.
        expect(tokens(button)).toContain("shrink");
        expect(tokens(button)).not.toContain("shrink-0");
        // The svg variant is a different class and must survive.
        expect(tokens(button)).toContain("[&_svg]:shrink-0");
        // Unrelated base classes survive.
        expect(tokens(button)).toContain("font-sans");
    });
});
