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

describe("PileChip compact mode (#1815 review fixup)", () => {
    // The controller bottom bar's inline "Zones" cell fits THREE of these
    // side by side inside a single quarter-width grid cell (~97px at a 390px
    // viewport) — the default `min-w-14` (56px) floor alone would blow past
    // that 3x over. `compact` drops the WIDTH floor (`flex-1 min-w-0` shares
    // the container's real width instead of hardcoding a px value) but KEEPS
    // the `min-h-11` HEIGHT floor: the bar row is already taller than 44px,
    // so the touch target's generous axis comes from the bar, not the chip.
    it("keeps the min-h-11 height floor but drops the min-w-14 width floor", () => {
        render(
            <PileChip
                label="GY"
                count={0}
                onClick={vi.fn()}
                data-testid="chip-gy-compact"
                compact
            />
        );
        const chip = screen.getByTestId("chip-gy-compact");
        expect(chip.className).toContain("min-h-11");
        expect(chip.className).not.toContain("min-w-14");
        expect(chip.className).toContain("flex-1");
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
