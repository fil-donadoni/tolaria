// #1770 mobile QA sweep — touch-target audit. `PileChip` backs the portrait
// GY/LIB/EXL/STACK chips (`board-portrait-chips.tsx`'s opponent row and the
// stack chip, both via `board-pile-chips.tsx` in the default/non-compact
// case). Its `py-1 text-[10px]` content rendered at roughly 24-26px tall —
// well under the 44px touch-target floor every other bar/pill control in the
// portrait and landscape-compact controls meets.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PileChip from "../pile-chip";

describe("PileChip touch target (#1770 mobile QA sweep)", () => {
    it("meets the 44px floor on both axes via a min-height/min-width floor", () => {
        render(
            <PileChip
                label="GY"
                count={0}
                onClick={vi.fn()}
                data-testid="chip-gy"
            />
        );
        const chip = screen.getByTestId("chip-gy");
        expect(chip.className).toContain("min-h-11");
        expect(chip.className).toContain("min-w-14");
    });

    it("still dispatches its click through the floor", () => {
        const onClick = vi.fn();
        render(
            <PileChip
                label="LIB"
                count={3}
                onClick={onClick}
                data-testid="chip-lib"
            />
        );
        screen.getByTestId("chip-lib").click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});

describe("PileChip compact mode (#1815 review fixup, round 2)", () => {
    // The controller bottom bar's inline "Zones" cell fits THREE of these
    // side by side. Round 1 fit them inside a single QUARTER-width grid cell
    // (~97px at 390px) by dropping the default `min-w-14` (56px) floor down to
    // `min-w-0`/`flex-1` — but 3-way division of a quarter cell landed each
    // chip at 23-29px, under the #1770 44px floor (and even the raw 24px WCAG
    // minimum). Round 2 fixes it at both ends: the bar cell is now HALF the
    // bar (`controller-bottom-bar.tsx`'s `grid-cols-6` + `col-span-3`, giving
    // `flex-1` ≈48-65px/chip across 320-390px) AND this chip keeps its own
    // explicit `min-w-11` (44px) floor — a positive, class-asserted guarantee
    // that doesn't rely solely on the cell math staying exactly right.
    // Touch-target size is governed by the SMALLER of an element's two axes
    // (WCAG SC 2.5.8): `min-h-11` alone (the bar row's height) never
    // satisfied it once this cell subdivides into three — width needed its
    // own floor too.
    it("has an explicit 44px floor on BOTH axes (min-h-11 AND min-w-11), not height alone", () => {
        render(
            <PileChip
                label="GY"
                count={0}
                onClick={vi.fn()}
                data-testid="chip-gy-compact"
                compact
                grow
            />
        );
        const chip = screen.getByTestId("chip-gy-compact");
        expect(chip.className).toContain("min-h-11");
        expect(chip.className).toContain("min-w-11");
        // `grow` (bar cell only) is what carries `flex-1` — the width-sharing
        // half of the round-2 guarantee this block documents.
        expect(chip.className).toContain("flex-1");
    });

    it("omits flex-1 without `grow` (#1867 — the vertical opponent column must not grow on the column axis)", () => {
        render(
            <PileChip
                label="GY"
                count={0}
                onClick={vi.fn()}
                data-testid="chip-gy-compact-nogrow"
                compact
            />
        );
        const chip = screen.getByTestId("chip-gy-compact-nogrow");
        expect(chip.className).not.toContain("flex-1");
        expect(chip.className).toContain("min-h-11");
        expect(chip.className).toContain("min-w-11");
    });

    it("uses a readable 10px label/count font, not the illegible 8px round 1 shipped", () => {
        render(
            <PileChip
                label="GY"
                count={0}
                onClick={vi.fn()}
                data-testid="chip-gy-compact-font"
                compact
            />
        );
        const chip = screen.getByTestId("chip-gy-compact-font");
        expect(chip.className).toContain("text-[10px]");
        expect(chip.className).not.toContain("text-[8px]");
    });

    it("still dispatches its click and shows the count", () => {
        const onClick = vi.fn();
        render(
            <PileChip
                label="EXL"
                count={5}
                onClick={onClick}
                data-testid="chip-exl-compact"
                compact
            />
        );
        const chip = screen.getByTestId("chip-exl-compact");
        expect(chip.textContent).toContain("EXL");
        expect(chip.textContent).toContain("5");
        chip.click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
