// The Mode Tile grid (ADR 0103 §6, issue #2726). Selection behaviour is
// proven end-to-end in `lobby.test.tsx` (a tile renames the primary action);
// what this file holds is the tile's own two structural promises — a pressed
// toggle, and art that is DECORATION on every count the ui-gate probe checks.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { lobbyModeTiles } from "~/lib/lobbyModes";
import LobbyModeTiles from "../lobby-mode-tiles";

const tiles = lobbyModeTiles({
    mode: "arena",
    difficulty: "medium",
    liveLimitedEvents: 0,
});

describe("LobbyModeTiles (issue #2726)", () => {
    it("renders one pressed toggle per offered mode", () => {
        const { container } = render(
            <LobbyModeTiles tiles={tiles} selected="solo" onSelect={vi.fn()} />
        );
        const buttons = [
            ...container.querySelectorAll<HTMLButtonElement>(
                "[data-mode-tile]"
            ),
        ];
        expect(buttons.map((b) => b.dataset.modeTile)).toEqual([
            "bot",
            "solo",
            "table",
            "limited",
        ]);
        expect(
            buttons.filter((b) => b.getAttribute("aria-pressed") === "true")
                .length
        ).toBe(1);
        expect(
            buttons
                .find((b) => b.dataset.modeTile === "solo")!
                .getAttribute("aria-pressed")
        ).toBe("true");
    });

    it("reports the pressed tile's key", () => {
        const onSelect = vi.fn();
        const { container } = render(
            <LobbyModeTiles tiles={tiles} selected="bot" onSelect={onSelect} />
        );
        fireEvent.click(
            container.querySelector<HTMLButtonElement>(
                '[data-mode-tile="table"]'
            )!
        );
        expect(onSelect).toHaveBeenCalledWith("table");
    });

    it("keeps every tile's art out of the CARD census", () => {
        // `scripts/ui-gate/probe.js` counts a card by its `<img>` and excludes
        // anything `aria-hidden`. Four full-bleed art tiles that failed this
        // would each score as a card occluded by its own veil — a hard floor
        // (`cardsOcc 0`) breaking on decoration.
        const { container } = render(
            <LobbyModeTiles tiles={tiles} selected="bot" onSelect={vi.fn()} />
        );
        const imgs = [...container.querySelectorAll("img")];
        expect(imgs.length).toBe(tiles.length);
        for (const img of imgs) {
            expect(img.getAttribute("aria-hidden")).toBe("true");
            expect(img.getAttribute("alt")).toBe("");
        }
    });

    it("names each tile by its own visible text, never by an aria-label", () => {
        // The Loadout's plate takes the tile TITLE as its accessible name, so
        // a tile whose name were also exactly the title would make the two
        // indistinguishable to a query — and to a screen-reader user.
        const { queryByRole, container } = render(
            <LobbyModeTiles tiles={tiles} selected="bot" onSelect={vi.fn()} />
        );
        const tile = container.querySelector<HTMLButtonElement>(
            '[data-mode-tile="bot"]'
        )!;
        expect(tile.hasAttribute("aria-label")).toBe(false);
        // The name carries the title but is NOT the title, so an exact-name
        // query for "Play vs Bot" resolves to the Loadout's plate and nothing
        // else. (There is no plate in this render — hence `null`.)
        expect(tile.textContent).toContain("Play vs Bot");
        expect(queryByRole("button", { name: "Play vs Bot" })).toBeNull();
    });
});
