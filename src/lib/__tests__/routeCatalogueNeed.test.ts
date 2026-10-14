import { describe, it, expect } from "vitest";
import { routeCatalogueNeed } from "../routeCatalogueNeed";

/** What `RouteOutlet` asks of the catalogue for a match tree (issue #5615):
 *  gated by default, the whole catalogue by default, the game route's own
 *  Sets only when every gated match says so. */

const root = { routeId: "__root__", staticData: {} };
const light = { routeId: "/lobby", staticData: { lightSurface: true } };
const plain = { routeId: "/decks", staticData: {} };
const game = { routeId: "/game", staticData: { catalogue: "game" as const } };

describe("routeCatalogueNeed", () => {
    it("none: the root plus light surfaces only", () => {
        expect(routeCatalogueNeed([root])).toBe("none");
        expect(routeCatalogueNeed([root, light])).toBe("none");
    });

    it("whole: a match that declares nothing — gated is the default", () => {
        expect(routeCatalogueNeed([root, plain])).toBe("whole");
        expect(routeCatalogueNeed([root, light, plain])).toBe("whole");
    });

    it("game: every gated match declares catalogue: game", () => {
        expect(routeCatalogueNeed([root, game])).toBe("game");
        expect(routeCatalogueNeed([root, light, game])).toBe("game");
    });

    it("whole wins over game when a gated match beside it needs everything", () => {
        expect(routeCatalogueNeed([root, game, plain])).toBe("whole");
    });
});
