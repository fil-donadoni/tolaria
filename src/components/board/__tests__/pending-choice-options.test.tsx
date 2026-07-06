// Option-pick choice UI (#289 — Primal Clay / Shapeshifter choose-body-on-
// entry). The `PendingChoiceOptions` button row renders one button per
// author-supplied option and fires `onPick` with the chosen option id;
// `pendingChoiceLabel("option-pick")` gives the prompt's source tag. Together
// these are the frontend half of the GRE→game.ts→UI option-pick path.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import PendingChoiceOptions from "~/components/board/pending-choice-options";
import { pendingChoiceLabel } from "~/lib/pending-choice-labels";

afterEach(cleanup);

const PRIMAL_CLAY_OPTIONS = [
    { id: "3-3", label: "3/3" },
    { id: "2-2-flying", label: "2/2 flying" },
    { id: "1-6-wall", label: "1/6 Wall (defender)" },
];

describe("PendingChoiceOptions (option-pick UI, #289)", () => {
    it("renders one button per option with its label", () => {
        const { getByText } = render(
            <PendingChoiceOptions
                options={PRIMAL_CLAY_OPTIONS}
                disabled={false}
                onPick={() => {}}
            />
        );
        expect(getByText("3/3")).toBeTruthy();
        expect(getByText("2/2 flying")).toBeTruthy();
        expect(getByText("1/6 Wall (defender)")).toBeTruthy();
    });

    it("fires onPick with the chosen option id", () => {
        const onPick = vi.fn();
        const { getByText } = render(
            <PendingChoiceOptions
                options={PRIMAL_CLAY_OPTIONS}
                disabled={false}
                onPick={onPick}
            />
        );
        fireEvent.click(getByText("2/2 flying"));
        expect(onPick).toHaveBeenCalledWith("2-2-flying");
    });

    it("does not fire onPick while disabled", () => {
        const onPick = vi.fn();
        const { getByText } = render(
            <PendingChoiceOptions
                options={PRIMAL_CLAY_OPTIONS}
                disabled
                onPick={onPick}
            />
        );
        fireEvent.click(getByText("3/3"));
        expect(onPick).not.toHaveBeenCalled();
    });
});

describe("pendingChoiceLabel for option-pick (#289)", () => {
    it("returns a non-empty source tag", () => {
        expect(pendingChoiceLabel("option-pick")).toBe("Choose");
    });
});

describe("pendingChoiceLabel for land-entry-tapped (ADR 0051)", () => {
    it("tags the shock-land pay-choice", () => {
        expect(pendingChoiceLabel("land-entry-tapped")).toBe("Pay 2 life");
    });
});
