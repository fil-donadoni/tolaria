// #1770 mobile QA sweep touch-target audit: the `[-]`/`[+]` divide-as-choose
// dial rendered at `w-6 h-6` (24px) — well under the 44px floor.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DivideTargetStepper from "../divide-target-stepper";

describe("DivideTargetStepper touch target (#1770 mobile QA sweep)", () => {
    it("sizes both buttons to the 44px touch-target floor", () => {
        render(
            <DivideTargetStepper
                n={1}
                canMinus
                canPlus
                onMinus={vi.fn()}
                onPlus={vi.fn()}
            />
        );
        for (const btn of [
            screen.getByLabelText("Assign one less"),
            screen.getByLabelText("Assign one more"),
        ]) {
            expect(btn.className).toContain("w-11");
            expect(btn.className).toContain("h-11");
        }
    });

    it("still dispatches +/- through the floor", () => {
        const onMinus = vi.fn();
        const onPlus = vi.fn();
        render(
            <DivideTargetStepper
                n={1}
                canMinus
                canPlus
                onMinus={onMinus}
                onPlus={onPlus}
            />
        );
        screen.getByLabelText("Assign one less").click();
        screen.getByLabelText("Assign one more").click();
        expect(onMinus).toHaveBeenCalledTimes(1);
        expect(onPlus).toHaveBeenCalledTimes(1);
    });
});
