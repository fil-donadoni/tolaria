// Numeric-nomination choice UI (CR 107.1b / 107.3f, issue #1701 — "pay any
// amount of mana", "you may pay {X}"). `NumberAmountInput` is a BOUNDED
// stepper: the ceiling is the choice's live range, computed by the parent from
// `numberChoiceRange` — the same server authority `applyNumberChoiceSubmit`
// re-validates against — so the prompt can never offer an amount the mutation
// would refuse. Together with `pendingChoiceLabel("number-pick")` this is the
// frontend half of the GRE→game.ts→UI numeric-nomination path.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import NumberAmountInput from "~/components/board/number-amount-input";
import { pendingChoiceLabel } from "~/lib/pending-choice-labels";
import { numberChoiceRange } from "@convex/gre/state";

afterEach(cleanup);

describe("NumberAmountInput (number-pick UI, issue #1701)", () => {
    it("declines in ONE action — the value starts at the floor and confirm is live there", () => {
        // CR 107.3f — paying {X} with X = 0 and declining are game-observably
        // identical, so 0 IS the decline and there is no second prompt to
        // dismiss (Arena parity, issue #2244).
        const onSubmit = vi.fn();
        const { getByText } = render(
            <NumberAmountInput
                min={0}
                max={4}
                paysMana
                disabled={false}
                onSubmit={onSubmit}
            />
        );
        const confirm = getByText("Decline") as HTMLButtonElement;
        expect(confirm.disabled).toBe(false);
        fireEvent.click(confirm);
        expect(onSubmit).toHaveBeenCalledWith(0);
    });

    it("clamps the stepper to the range at both ends", () => {
        const onSubmit = vi.fn();
        const { getByLabelText, getByText } = render(
            <NumberAmountInput
                min={0}
                max={2}
                paysMana
                disabled={false}
                onSubmit={onSubmit}
            />
        );
        const minus = getByLabelText("Decrease amount") as HTMLButtonElement;
        const plus = getByLabelText("Increase amount") as HTMLButtonElement;
        expect(minus.disabled).toBe(true); // already at the floor

        fireEvent.click(plus);
        fireEvent.click(plus);
        expect(plus.disabled).toBe(true); // ceiling reached
        fireEvent.click(getByText("Pay 2"));
        expect(onSubmit).toHaveBeenCalledWith(2);
    });

    it("clamps a typed amount above the ceiling instead of submitting it", () => {
        const onSubmit = vi.fn();
        const { getByLabelText, getByText } = render(
            <NumberAmountInput
                min={0}
                max={3}
                paysMana
                disabled={false}
                onSubmit={onSubmit}
            />
        );
        fireEvent.change(getByLabelText("Amount"), {
            target: { value: "99" },
        });
        fireEvent.click(getByText("Pay 3"));
        expect(onSubmit).toHaveBeenCalledWith(3);
    });

    it("disables every control while the mutation is in flight", () => {
        const { getByLabelText, getByText } = render(
            <NumberAmountInput
                min={0}
                max={3}
                paysMana
                disabled
                onSubmit={() => {}}
            />
        );
        expect(
            (getByLabelText("Increase amount") as HTMLButtonElement).disabled
        ).toBe(true);
        expect((getByText("Decline") as HTMLButtonElement).disabled).toBe(true);
    });
});

describe("number-pick wiring (issue #1701)", () => {
    it("has a prompt label — an unlabelled kind renders a blank banner title", () => {
        expect(pendingChoiceLabel("number-pick")).toBe("Choose an amount");
    });

    it("the client reads the SAME range authority the server validates with", () => {
        // A paying nomination's ceiling is the payer's live spendable pool,
        // including CR 106.6 restricted mana the may-pay path can spend — the
        // whole reason the bound is a shared function and not a client-side
        // sum of `manaPool`.
        const choice = { paysMana: true as const };
        expect(
            numberChoiceRange(choice, {
                manaPool: { W: 2, G: 1 },
                restrictedMana: undefined,
            })
        ).toEqual({ min: 0, max: 3 });
        expect(
            numberChoiceRange(choice, {
                manaPool: {},
                restrictedMana: undefined,
            })
        ).toEqual({ min: 0, max: 0 });
    });
});
