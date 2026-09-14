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
import {
    pendingChoiceLabel,
    pendingChoiceRequiresBoardTap,
} from "~/lib/pending-choice-labels";
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

    it("pins the banner for a PAYING nomination — the payer must reach the board to raise the ceiling", () => {
        // CR 608.2g — the only way to lift a paying nomination's ceiling is to
        // tap lands with the prompt open, so a centered banner would cover the
        // permanents the decision depends on. A nomination that pays nothing
        // has nothing on the mid-board to reach.
        const base = {
            stackItemId: "s1",
            step: 0,
            choiceId: "$paid",
            playerId: "p1",
            count: 1,
            prompt: "Pay any amount of mana",
        } as const;
        expect(
            pendingChoiceRequiresBoardTap({
                ...base,
                kind: "number-pick",
                paysMana: true,
            })
        ).toBe(true);
        expect(
            pendingChoiceRequiresBoardTap({ ...base, kind: "number-pick" })
        ).toBe(false);
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
        // The restricted bucket, which is the whole reason this is a shared
        // function and not a client-side sum of `manaPool`: a cumulative-upkeep
        // unit counts for a nomination carrying that restriction …
        expect(
            numberChoiceRange(
                { paysMana: true, manaRestriction: "cumulative-upkeep" },
                {
                    manaPool: { W: 1 },
                    restrictedMana: [
                        {
                            color: "G",
                            amount: 2,
                            restriction: "cumulative-upkeep",
                        },
                    ],
                }
            )
        ).toEqual({ min: 0, max: 3 });
        // … and not for one carrying none (CR 106.6 — exact match, ADR 0022).
        expect(
            numberChoiceRange(choice, {
                manaPool: { W: 1 },
                restrictedMana: [
                    { color: "G", amount: 2, restriction: "cumulative-upkeep" },
                ],
            })
        ).toEqual({ min: 0, max: 1 });
    });
});
