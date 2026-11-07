// CR 115.7d — the banner's "Keep" row submits a current target through the same
// `selectTarget` mutation a board click uses; nothing renders on a selection
// with nothing to keep, so an ordinary cast prompt is unchanged.
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingTarget } from "~/types/game";
import KeepTargetButtons from "../keep-target-buttons";

const selectTarget = vi.fn(() => Promise.resolve());
vi.mock("convex/react", () => ({ useMutation: () => selectTarget }));
vi.mock("@convex/_generated/api", () => ({
    api: { game: { selectTarget: {} } },
}));

const GAME = "g1" as Id<"games">;
const base = {
    playerId: "p1",
    cardInstanceId: "spell",
    targetType: "Creature",
    count: 2,
    selected: [],
} as unknown as PendingTarget;

afterEach(() => {
    cleanup();
    selectTarget.mockClear();
});

describe("KeepTargetButtons (CR 115.7d)", () => {
    it("renders nothing with nothing to keep", () => {
        const { container } = render(
            <KeepTargetButtons
                pendingTarget={base}
                players={[]}
                stack={[]}
                gameId={GAME}
                playerId="p1"
            />
        );
        expect(container.firstChild).toBeNull();
    });

    it("a click submits the kept target", () => {
        render(
            <KeepTargetButtons
                pendingTarget={{
                    ...base,
                    keepableTargetGroups: [[{ type: "permanent", id: "gone" }]],
                }}
                players={[]}
                stack={[]}
                gameId={GAME}
                playerId="p1"
            />
        );
        fireEvent.click(
            screen.getByRole("button", { name: "Keep departed target" })
        );
        expect(selectTarget).toHaveBeenCalledWith({
            gameId: GAME,
            playerId: "p1",
            targetType: "permanent",
            targetId: "gone",
        });
    });
});
