// `DeckMiniCurve` (issue #2584: the bottom bar's reduced mana-curve sparkline)
// carried a prohibited `aria-label` on its per-bar `<span>` — a bare `<span>`
// has no implicit role, and axe's `aria-prohibited-attr` rule flags
// `aria-label`/`aria-labelledby` on an element whose role doesn't support
// accessible naming. The component renders nothing on an empty Maindeck
// (`if (total === 0) return null`), so this was invisible to
// `bun run check:ui` until issue #2671 made the `/decks/create` walk seed a
// non-empty deck — see `scripts/ui-gate/surfaces.ts` and the `deck-builder`
// budgets. Fixed by dropping the per-bar `aria-label`, matching
// `DeckStatsCurveChart`'s own pattern (the full Stats dialog chart this is a
// reduced twin of): the parent `role="group"` names the whole sparkline,
// `title` stays as the sighted-hover per-bucket detail.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import DeckMiniCurve from "../deck-mini-curve";

afterEach(cleanup);

describe("DeckMiniCurve (issue #2671)", () => {
    it("renders nothing on an empty curve", () => {
        const { container } = render(<DeckMiniCurve curve={[0, 0, 0]} />);
        expect(container.firstChild).toBeNull();
    });

    it("names the whole sparkline via the parent role=group, never a per-bar aria-label", () => {
        const { container } = render(
            <DeckMiniCurve curve={[1, 0, 2, 0, 0, 0, 0, 0]} />
        );
        const group = container.querySelector('[role="group"]');
        expect(group).toBeTruthy();
        expect(group?.getAttribute("aria-label")).toBe("Maindeck mana curve");

        const bars = container.querySelectorAll("span");
        expect(bars.length).toBeGreaterThan(0);
        for (const bar of bars) {
            // The regression this test guards: `aria-label` on a bare `<span>`
            // is a prohibited ARIA attribute (no role supports naming it) —
            // axe's `aria-prohibited-attr` rule reds on exactly this shape.
            expect(bar.hasAttribute("aria-label")).toBe(false);
            // The sighted-hover detail stays on `title`.
            expect(bar.hasAttribute("title")).toBe(true);
        }
    });
});
