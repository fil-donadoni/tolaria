// CR 601.2f — RestrictedXSplitDialog: the caster's split of a cost reduction
// between a restricted X and the fixed generic. Verifies one button per offered
// option, the `selectRestrictedXSplit` submission shape, and disable-while-pending.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const selectRestrictedXSplit = vi.fn();
const cancelCast = vi.fn();

vi.mock("convex/react", () => ({
    useMutation: (fn: { __name: string }) => {
        if (fn.__name === "selectRestrictedXSplit") {
            return selectRestrictedXSplit;
        }
        if (fn.__name === "cancelCast") return cancelCast;
        throw new Error(`unexpected mutation: ${fn.__name}`);
    },
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            selectRestrictedXSplit: { __name: "selectRestrictedXSplit" },
            cancelCast: { __name: "cancelCast" },
        },
    },
}));

import RestrictedXSplitDialog from "../restricted-x-split-dialog";

function mount(options: number[]) {
    render(
        <RestrictedXSplitDialog
            choice={{ options }}
            gameId={"g" as never}
            playerId="p1"
        />
    );
}

describe("RestrictedXSplitDialog (CR 601.2f)", () => {
    beforeEach(() => {
        cleanup();
        selectRestrictedXSplit.mockReset().mockResolvedValue(undefined);
        cancelCast.mockReset().mockResolvedValue(undefined);
    });

    it("offers exactly the options the server parked", () => {
        mount([0, 2]);
        expect(screen.getByText("Reduce X first")).toBeTruthy();
        expect(screen.getByText("Move 2 to the fixed cost")).toBeTruthy();
        expect(screen.queryByText("Move 1 to the fixed cost")).toBeNull();
    });

    it("clicking an option submits its points", () => {
        mount([0, 2]);
        fireEvent.click(screen.getByText("Move 2 to the fixed cost"));
        expect(selectRestrictedXSplit).toHaveBeenCalledWith({
            gameId: "g",
            playerId: "p1",
            pointsOnX: 2,
        });
    });

    it("disables the options while a submission is pending", () => {
        selectRestrictedXSplit.mockReturnValue(new Promise(() => {}));
        mount([0, 1]);
        fireEvent.click(screen.getByText("Reduce X first"));
        fireEvent.click(screen.getByText("Move 1 to the fixed cost"));
        expect(selectRestrictedXSplit).toHaveBeenCalledTimes(1);
    });
});
