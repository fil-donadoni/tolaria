// Pick Ratings admin tool (PRD #8772, issue #8908). Drives the page through
// the REAL `listScopeCardRatings` projection (`listScopeCards` +
// `buildScopeCardRatings` over the real seed) rather than a hand-built stub: a
// synthetic row can't catch a field the projection drops.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import {
    buildScopeCardRatings,
    listScopeCards,
    type GetDbRating,
} from "@convex/limited/cardRatingsCore";
import { CUBE_SOURCE_KEY } from "@convex/limited/cube";
import { getPickRating } from "@convex/limited/pickRatings";
import { tryGetCardByName } from "@convex/cards";
import PickRatingsPage from "../pick-ratings-page";
import type { ScopeCardRating } from "~/hooks/useCardRatings";

const page = vi.hoisted(() => ({ cards: undefined as unknown }));

vi.mock("~/hooks/useLimitedEvent", () => ({
    useDraftableSets: () => [
        {
            setCode: "vintage-cube",
            draftable: true,
            missingCardCount: 0,
            sheets: [],
            isCube: true,
            availableCardCount: 283,
        },
    ],
}));

vi.mock("~/hooks/useCardProfiles", async () => {
    const { ARCHETYPE_CATALOGUE_SEED: seed } =
        await import("@convex/limited/archetypeCatalogueCore");
    return { useArchetypeCatalogue: () => seed };
});

vi.mock("~/hooks/useCardRatings", () => ({
    useScopeCardRatings: () => page.cards,
}));

afterEach(() => {
    page.cards = undefined;
});

const SAMPLE = ["Lightning Bolt", "Black Lotus", "Griselbrand"] as const;

function cardId(name: string): string {
    const def = tryGetCardByName(name);
    if (!def) throw new Error(`test fixture: no card named "${name}"`);
    return def.id;
}

function rows(db: Record<string, number> = {}): ScopeCardRating[] {
    const wanted = new Set<string>(SAMPLE.map(cardId));
    const cards = listScopeCards(CUBE_SOURCE_KEY).filter((c) =>
        wanted.has(c.cardId)
    );
    const getDbRating: GetDbRating = (_scope, id) => db[id] ?? null;
    return buildScopeCardRatings(CUBE_SOURCE_KEY, cards, getDbRating).sort(
        (a, b) => a.name.localeCompare(b.name)
    ) as ScopeCardRating[];
}

function names(): string[] {
    return screen
        .getAllByRole("row")
        .slice(1)
        .map((row) => SAMPLE.find((n) => row.textContent?.includes(n)) ?? "?");
}

function pickFilter(filter: string, option: string) {
    const trigger = screen
        .getAllByRole("button", { name: new RegExp(`^${filter}`) })
        .find((button) => button.hasAttribute("aria-expanded"));
    if (!trigger) throw new Error(`no ${filter} filter`);
    if (!screen.queryByRole("option", { name: option }))
        fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: option }));
}

describe("PickRatingsPage (issue #8908)", () => {
    it("renders a loading state while the query is in flight", () => {
        page.cards = undefined;
        render(<PickRatingsPage />);
        expect(screen.getByText("Loading…")).toBeTruthy();
    });

    it("lists the columns Card, Cost, Rarity, Archetypes, Rating, Source", () => {
        page.cards = rows();
        render(<PickRatingsPage />);
        const heads = screen
            .getAllByRole("columnheader")
            .map((h) => h.textContent);
        expect(heads).toEqual([
            "Card",
            "Cost",
            "Rarity",
            "Archetypes",
            "Rating",
            "Source",
        ]);
    });

    it("labels a card with neither layer 'Scope median' and shows the median as its rating", () => {
        // The cube seed rates every card; Alpha's seed has no Griselbrand.
        const id = cardId("Griselbrand");
        expect(getPickRating("lea", id)).toBeNull();
        const [card] = buildScopeCardRatings(
            "lea",
            [{ cardId: id, name: "Griselbrand" }],
            () => null
        ) as ScopeCardRating[];
        page.cards = [card];
        render(<PickRatingsPage />);
        const row = screen.getByText(card.name).closest("tr")!;
        expect(within(row).getByText("Scope median")).toBeTruthy();
        expect(row.textContent).toContain(card.fallbackRating.toFixed(1));
    });

    it("Source = Override finds a hand-written rating even when it equals the seed", () => {
        const seeded = SAMPLE.map((n) => ({
            n,
            seed: getPickRating(CUBE_SOURCE_KEY, cardId(n)),
        })).find((entry) => entry.seed !== null);
        if (!seeded) throw new Error("fixture: no seeded sample card");
        page.cards = rows({ [cardId(seeded.n)]: seeded.seed! });
        render(<PickRatingsPage />);
        expect(names()).toHaveLength(SAMPLE.length);
        pickFilter("Source", "Override");
        expect(names()).toEqual([seeded.n]);
        expect(screen.getAllByText("Override").length).toBeGreaterThan(0);
    });

    it("filters by Rarity and Type, AND across filters", () => {
        page.cards = rows();
        render(<PickRatingsPage />);
        pickFilter("Type", "Instant");
        expect(names()).toEqual(["Lightning Bolt"]);
        pickFilter("Rarity", "Mythic");
        expect(screen.getByText("No cards match your filters.")).toBeTruthy();
    });

    it("sorts by Rating, flipping direction on a second click (aria-sort)", () => {
        page.cards = rows({
            [cardId("Griselbrand")]: 4.9,
            [cardId("Black Lotus")]: 3,
            [cardId("Lightning Bolt")]: 0.5,
        });
        render(<PickRatingsPage />);
        const head = screen.getByRole("button", { name: /^Rating/ });
        fireEvent.click(head);
        expect(names()[0]).toBe("Lightning Bolt");
        expect(head.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
        fireEvent.click(head);
        expect(names()[0]).toBe("Griselbrand");
        expect(head.closest("th")?.getAttribute("aria-sort")).toBe(
            "descending"
        );
    });

    it("the rail counts overrides and hand-rated cards over the whole scope", () => {
        page.cards = rows({ [cardId("Lightning Bolt")]: 4 });
        render(<PickRatingsPage />);
        const rail = screen.getByRole("complementary", { name: "Scope rail" });
        expect(
            within(rail).getByText("Overrides").nextSibling?.textContent
        ).toBe("1");
        expect(
            within(rail).getByRole("progressbar", { name: "Hand-rated" })
        ).toBeTruthy();
        expect(within(rail).getByText("Red")).toBeTruthy();
    });
});
