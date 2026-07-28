// #1770 mobile QA sweep — touch-target audit. `PileChip` backs the portrait
// GY/LIB/EXL/STACK chips (`board-portrait-chips.tsx`'s opponent row, the
// Zones drawer's viewer row via `board-pile-chips.tsx`, and the stack chip).
// Its `py-1 text-[10px]` content rendered at roughly 24-26px tall — well
// under the 44px touch-target floor every other bar/pill control in the
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
