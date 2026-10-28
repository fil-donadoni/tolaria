// CR 701.43a / 508.1g — the exert marker on a battlefield card, both states.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { CardInstance } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import ExertBadge from "../exert-badge";

function renderBadge(card: Partial<CardInstance>, combat: unknown) {
    const ctx = { combat } as never;
    return render(
        <GameContext value={ctx}>
            <ExertBadge card={{ id: "a", ...card } as CardInstance} />
        </GameContext>
    );
}

describe("ExertBadge", () => {
    it("marks a pending exert distinctly from a paid one", () => {
        const pending = renderBadge(
            {},
            { attackerIds: ["a"], confirmed: false, exertedIds: ["a"] }
        );
        expect(
            pending.container.querySelector("[data-exert='pending']")
        ).not.toBeNull();
        pending.unmount();
        const paid = renderBadge({ skipNextUntap: true }, undefined);
        expect(
            paid.container.querySelector("[data-exert='paid']")
        ).not.toBeNull();
    });
    it("renders nothing for an unexerted permanent", () => {
        const { container } = renderBadge({}, undefined);
        expect(container.querySelector("[data-exert]")).toBeNull();
    });
});
