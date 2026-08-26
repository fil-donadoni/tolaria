// #1770 mobile QA sweep touch-target audit: the `[-]`/`[+]` divide-as-choose
// dial rendered at `w-6 h-6` (24px) — well under the 44px floor.
//
// v4 re-skin (issue #2730, ADR 0103 §3/§5): `bg-accent-soft`/
// `shadow-[...]` glow, `font-beleren` count → quiet hairline chrome, the
// chrome display face. The second `describe` below covers that slice —
// added on top of, never replacing, the #1770 touch-target coverage above
// (a correction to issue #2730's working map, which had listed this file as
// untested).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import DivideTargetStepper from "../divide-target-stepper";

afterEach(cleanup);

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

describe("DivideTargetStepper v4 re-skin (CR 601.2d, issue #2730)", () => {
    it("shows the count in the display face, not the retired Beleren card face", () => {
        render(
            <DivideTargetStepper
                n={2}
                canMinus
                canPlus
                onMinus={() => {}}
                onPlus={() => {}}
            />
        );
        const count = screen.getByText("2");
        expect(count.className).toContain("text-display");
        expect(count.className).not.toContain("font-beleren");
    });

    it("disables minus at zero and plus when the divide budget is exhausted", () => {
        render(
            <DivideTargetStepper
                n={0}
                canMinus={false}
                canPlus={false}
                onMinus={() => {}}
                onPlus={() => {}}
            />
        );
        expect(screen.getByLabelText("Assign one less")).toBeDisabled();
        expect(screen.getByLabelText("Assign one more")).toBeDisabled();
    });
});
