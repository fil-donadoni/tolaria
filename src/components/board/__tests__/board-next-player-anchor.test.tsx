// Slice #256 (PRD #249) — the spatial board exposes a target-arrow anchor per
// player so spells/abilities that target a player (e.g. burn to the face) can
// attach an arrow on the new board.
import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import BoardNextPlayerAnchor from "../board-next-player-anchor";

describe("BoardNextPlayerAnchor (#256)", () => {
    beforeEach(() => cleanup());

    it("emits data-arrow-anchor-player for the player id", () => {
        const { container } = render(
            <BoardNextPlayerAnchor playerId="opp" side="top" />
        );
        expect(
            container.querySelector('[data-arrow-anchor-player="opp"]')
        ).toBeTruthy();
    });

    it("anchors to the top edge for the opponent and the bottom edge for the viewer", () => {
        const top = render(<BoardNextPlayerAnchor playerId="opp" side="top" />);
        expect(
            top.container.querySelector("[data-arrow-anchor-player].top-0")
        ).toBeTruthy();
        cleanup();
        const bottom = render(
            <BoardNextPlayerAnchor playerId="me" side="bottom" />
        );
        expect(
            bottom.container.querySelector(
                "[data-arrow-anchor-player].bottom-0"
            )
        ).toBeTruthy();
    });

    it("is non-interactive (pointer-events-none, aria-hidden)", () => {
        const { container } = render(
            <BoardNextPlayerAnchor playerId="me" side="bottom" />
        );
        const el = container.querySelector<HTMLElement>(
            "[data-arrow-anchor-player]"
        );
        expect(el?.className).toContain("pointer-events-none");
        expect(el?.getAttribute("aria-hidden")).toBe("true");
    });
});
