// The lobby's Mode Tile descriptors (ADR 0103 §6, issue #2726).
//
// What these guard is the one thing a tile grid can get silently wrong: the
// tile a player pressed and the action the Loadout then runs are the SAME
// fact (`title`), and the tile set is swapped by the game mode. A key
// stranded by that swap must resolve to a tile the grid actually renders —
// otherwise the primary plate names an action nobody can see the tile for.
import { describe, it, expect } from "vitest";
import { lobbyModeTiles, resolveLobbyMode } from "../lobbyModes";

const inputs = { difficulty: "medium", liveLimitedEvents: 0 } as const;

describe("lobbyModeTiles (issue #2726)", () => {
    it("Arena offers the four ADR 0103 §6 tiles, in order", () => {
        expect(
            lobbyModeTiles({ mode: "arena", ...inputs }).map((t) => t.title)
        ).toEqual(["Play vs Bot", "Solo game", "Open a table", "Limited"]);
    });

    it("Cockatrice replaces the two engine tiles with the Manual solo table", () => {
        const tiles = lobbyModeTiles({ mode: "cockatrice", ...inputs });
        expect(tiles.map((t) => t.title)).toEqual([
            "Solo table",
            "Open a table",
            "Limited",
        ]);
        // "Not offered" means ABSENT, not disabled (issue #2591's contract,
        // carried over from the Play box's swapped action set).
        expect(tiles.some((t) => t.key === "bot")).toBe(false);
        expect(tiles.some((t) => t.key === "solo")).toBe(false);
    });

    it("only the Limited tile is exempt from the deck gate", () => {
        for (const mode of ["arena", "cockatrice"] as const) {
            for (const tile of lobbyModeTiles({ mode, ...inputs })) {
                expect(tile.needsDeck, tile.key).toBe(tile.key !== "limited");
            }
        }
    });

    it("the Bot tile's chip shows the chosen difficulty", () => {
        const chipFor = (difficulty: string) =>
            lobbyModeTiles({
                mode: "arena",
                difficulty,
                liveLimitedEvents: 0,
            }).find((t) => t.key === "bot")!.chip;
        expect(chipFor("easy")).toBe("Easy");
        expect(chipFor("hard")).toBe("Hard");
        // An unknown value degrades to a label, never to `undefined` painted
        // into the chip.
        expect(chipFor("nonsense")).toBe("Bot");
    });

    it("the Limited tile's chip counts live open events", () => {
        const chipFor = (liveLimitedEvents: number) =>
            lobbyModeTiles({
                mode: "arena",
                difficulty: "medium",
                liveLimitedEvents,
            }).find((t) => t.key === "limited")!.chip;
        expect(chipFor(0)).toBe("Draft · Sealed");
        expect(chipFor(3)).toBe("3 open");
    });

    it("every tile carries LOCAL art, never a CDN URL", () => {
        // Deterministic and offline: the ui-gate walks this surface at five
        // viewports, and a remote draw is what makes a probe count wobble
        // run to run (`budgets.json`'s `cardsOcc 1` ceiling).
        for (const mode of ["arena", "cockatrice"] as const)
            for (const tile of lobbyModeTiles({ mode, ...inputs }))
                expect(tile.art, tile.key).toMatch(/^\/img\//);
    });
});

describe("resolveLobbyMode (issue #2726)", () => {
    it("resolves a key the set offers", () => {
        const tiles = lobbyModeTiles({ mode: "arena", ...inputs });
        expect(resolveLobbyMode(tiles, "table").title).toBe("Open a table");
    });

    it("falls back to the first OFFERED tile when the key was stranded by a mode swap", () => {
        const tiles = lobbyModeTiles({ mode: "cockatrice", ...inputs });
        // "bot" only exists in the Arena set — resolving it must not hand
        // back a tile the Cockatrice grid never rendered.
        expect(resolveLobbyMode(tiles, "bot").key).toBe("manual-solo");
    });
});
