// Pick Ratings rating dialog (PRD #8772, issue #8909). Drives the page through
// the REAL `listScopeCardRatings` projection and asserts on the REAL
// `setCardRating` argument shape ({ scope, cardId, rating }).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
    render,
    screen,
    fireEvent,
    within,
    waitFor,
} from "@testing-library/react";
import {
    buildScopeCardRatings,
    listScopeCards,
    type GetDbRating,
} from "@convex/limited/cardRatingsCore";
import { CUBE_SOURCE_KEY } from "@convex/limited/cube";
import {
    contextCapForPick,
    DEFAULT_DRAFT_PICKS,
} from "@convex/limited/botDrafter";
import { tryGetCardByName } from "@convex/cards";
import PickRatingsPage from "../pick-ratings-page";
import type { ScopeCardRating } from "~/hooks/useCardRatings";
import { effectiveRating } from "../pick-ratings-model";
import { toStep } from "../pick-ratings-ladder-model";

const page = vi.hoisted(() => ({
    cards: undefined as unknown,
    setRating: undefined as unknown as ReturnType<typeof vi.fn>,
    clearRating: undefined as unknown as ReturnType<typeof vi.fn>,
}));

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
    useCardRatingMutations: () => ({
        setRating: page.setRating,
        clearRating: page.clearRating,
    }),
}));

const SAMPLE = [
    "Lightning Bolt",
    "Black Lotus",
    "Griselbrand",
    "Counterspell",
    "Sol Ring",
    "Swords to Plowshares",
] as const;

function cardId(name: string): string {
    const def = tryGetCardByName(name);
    if (!def) throw new Error(`test fixture: no card named "${name}"`);
    return def.id;
}

let db: Record<string, number> = {};

function build(): ScopeCardRating[] {
    const wanted = new Set<string>(SAMPLE.map(cardId));
    const cards = listScopeCards(CUBE_SOURCE_KEY).filter((c) =>
        wanted.has(c.cardId)
    );
    const getDbRating: GetDbRating = (_scope, id) => db[id] ?? null;
    return buildScopeCardRatings(CUBE_SOURCE_KEY, cards, getDbRating).sort(
        (a, b) => a.name.localeCompare(b.name)
    ) as ScopeCardRating[];
}

function byName(name: string): ScopeCardRating {
    const card = build().find((c) => c.name === name);
    if (!card) throw new Error(`fixture: ${name} not in the scope`);
    return card;
}

function openRow(name: string) {
    fireEvent.click(screen.getByText(name).closest("tr")!);
    return screen.getByRole("dialog");
}

function tableOrder(): string[] {
    return screen
        .getAllByRole("row", { hidden: true })
        .slice(1)
        .map((row) => SAMPLE.find((n) => row.textContent?.includes(n)) ?? "?");
}

beforeEach(() => {
    db = {};
    page.cards = build();
    page.setRating = vi.fn().mockResolvedValue(null);
    page.clearRating = vi.fn().mockResolvedValue(null);
});

afterEach(() => {
    page.cards = undefined;
});

describe("rating dialog: the ladder (issue #8909)", () => {
    it("shows the card's three layers and eleven rungs", () => {
        render(<PickRatingsPage />);
        const dialog = openRow("Lightning Bolt");
        const bolt = byName("Lightning Bolt");
        const layer = (source: string) =>
            dialog.querySelector(`[data-pick-rating-layer="${source}"]`)!
                .textContent;
        expect(layer("seed")).toContain(bolt.seedRating!.toFixed(1));
        expect(layer("override")).toContain("—");
        expect(layer("median")).toContain(bolt.fallbackRating.toFixed(1));
        expect(dialog.querySelectorAll("[data-pick-rating-rung]")).toHaveLength(
            11
        );
    });

    it("a rung click writes an Override at that rung's rating", async () => {
        render(<PickRatingsPage />);
        const dialog = openRow("Lightning Bolt");
        fireEvent.click(
            within(dialog).getByRole("button", {
                name: "Rate Lightning Bolt 1.5",
            })
        );
        expect(page.setRating).toHaveBeenCalledWith({
            scope: "vintage-cube",
            cardId: cardId("Lightning Bolt"),
            rating: 1.5,
        });
        await waitFor(() => expect(page.setRating).toHaveBeenCalledTimes(1));
    });

    it("clicking the rung the card already sits on writes an Override equal to the seed", () => {
        const bolt = byName("Lightning Bolt");
        render(<PickRatingsPage />);
        const dialog = openRow("Lightning Bolt");
        const step = toStep(effectiveRating(bolt));
        expect(toStep(bolt.seedRating!)).toBe(bolt.seedRating);
        fireEvent.click(
            within(dialog).getByRole("button", {
                name: `Rate Lightning Bolt ${step.toFixed(1)}`,
            })
        );
        expect(page.setRating).toHaveBeenCalledWith({
            scope: "vintage-cube",
            cardId: bolt.cardId,
            rating: bolt.seedRating,
        });
    });

    it("Compare with 'Whole scope' lists the other cards on their rungs, never the open one", () => {
        render(<PickRatingsPage />);
        const dialog = openRow("Lightning Bolt");
        fireEvent.click(
            within(dialog).getByRole("radio", { name: "Whole scope" })
        );
        const thumbs = [
            ...dialog.querySelectorAll("[data-pick-rating-thumb]"),
        ].map((el) => el.getAttribute("data-pick-rating-thumb"));
        const others = SAMPLE.filter((n) => n !== "Lightning Bolt").map(cardId);
        for (const id of others) expect(thumbs).toContain(id);
        // The open card appears once: its own marker on its rung.
        expect(
            thumbs.filter((id) => id === cardId("Lightning Bolt"))
        ).toHaveLength(1);
    });
});

describe("rating dialog: reposition stack (issue #8909)", () => {
    it("opens a neighbour, rates it, and Back returns to the pass card", () => {
        render(<PickRatingsPage />);
        let dialog = openRow("Lightning Bolt");
        fireEvent.click(
            within(dialog).getByRole("radio", { name: "Whole scope" })
        );
        const neighbour = dialog.querySelector(
            `[data-pick-rating-thumb="${cardId("Sol Ring")}"]`
        )!;
        fireEvent.click(neighbour);

        dialog = screen.getByRole("dialog");
        expect(
            within(dialog).getAllByText("Opened from Lightning Bolt")
        ).not.toHaveLength(0);
        // The click opened the neighbour; it did not rate the open card.
        expect(page.setRating).not.toHaveBeenCalled();

        fireEvent.click(
            within(dialog).getByRole("button", { name: "Rate Sol Ring 2.0" })
        );
        expect(page.setRating).toHaveBeenCalledWith({
            scope: "vintage-cube",
            cardId: cardId("Sol Ring"),
            rating: 2,
        });

        fireEvent.click(
            within(dialog).getByRole("button", {
                name: "← Back to Lightning Bolt",
            })
        );
        expect(
            within(screen.getByRole("dialog")).getAllByText(
                /of 6 in the current list/
            )
        ).not.toHaveLength(0);
        expect(
            screen
                .getByRole("dialog")
                .querySelector("[data-pick-rating-dialog-art]")
                ?.getAttribute("data-pick-rating-dialog-art")
        ).toBe(cardId("Lightning Bolt"));
    });

    it("nests: Back from the second detour returns to the first", () => {
        render(<PickRatingsPage />);
        let dialog = openRow("Lightning Bolt");
        fireEvent.click(
            within(dialog).getByRole("radio", { name: "Whole scope" })
        );
        fireEvent.click(
            dialog.querySelector(
                `[data-pick-rating-thumb="${cardId("Sol Ring")}"]`
            )!
        );
        dialog = screen.getByRole("dialog");
        fireEvent.click(
            dialog.querySelector(
                `[data-pick-rating-thumb="${cardId("Counterspell")}"]`
            )!
        );
        dialog = screen.getByRole("dialog");
        fireEvent.click(
            within(dialog).getByRole("button", { name: "← Back to Sol Ring" })
        );
        expect(
            within(screen.getByRole("dialog")).getByRole("button", {
                name: "← Back to Lightning Bolt",
            })
        ).toBeTruthy();
    });
});

describe("rating dialog: frozen walk (issue #8909)", () => {
    it("a rating change that re-sorts the table does not change the next card", () => {
        db = {
            [cardId("Black Lotus")]: 5,
            [cardId("Counterspell")]: 4,
            [cardId("Griselbrand")]: 3,
            [cardId("Lightning Bolt")]: 2,
            [cardId("Sol Ring")]: 1,
            [cardId("Swords to Plowshares")]: 0.5,
        };
        page.cards = build();
        const { rerender } = render(<PickRatingsPage />);
        fireEvent.click(screen.getByRole("button", { name: /^Rating/ }));
        fireEvent.click(screen.getByRole("button", { name: /^Rating/ }));
        const before = tableOrder();
        const [first, second] = before;

        page.setRating = vi.fn().mockImplementation(async () => {
            // The write lands: the open card now rates lowest, re-sorting
            // the table under the open dialog.
            db = { ...db, [cardId(first)]: 0 };
            page.cards = build();
            rerender(<PickRatingsPage />);
            return null;
        });

        const dialog = openRow(first);
        fireEvent.click(
            within(dialog).getByRole("button", { name: `Rate ${first} 0.0` })
        );
        return waitFor(() => {
            expect(tableOrder()).not.toEqual(before);
        }).then(() => {
            fireEvent.click(
                within(screen.getByRole("dialog")).getByRole("button", {
                    name: "Next →",
                })
            );
            expect(
                screen
                    .getByRole("dialog")
                    .querySelector("[data-pick-rating-dialog-art]")
                    ?.getAttribute("data-pick-rating-dialog-art")
            ).toBe(cardId(second));
        });
    });
});

describe("rating dialog: pack test (issue #8909)", () => {
    function openPack() {
        render(<PickRatingsPage />);
        const dialog = openRow("Lightning Bolt");
        fireEvent.click(
            within(dialog).getByRole("radio", { name: "Pack test" })
        );
        return screen.getByRole("dialog");
    }

    it("keeps 'Top of a random pack' on both tabs", () => {
        const dialog = openPack();
        expect(dialog.querySelector("[data-pick-rating-top]")).toBeTruthy();
        fireEvent.click(within(dialog).getByRole("radio", { name: "Ladder" }));
        expect(dialog.querySelector("[data-pick-rating-top]")).toBeTruthy();
    });

    it("shows the scorer's own context cap for the pick, live", () => {
        const dialog = openPack();
        const cap = () =>
            dialog.querySelector("[data-pick-rating-cap]")!.textContent;
        expect(cap()).toBe(
            contextCapForPick(1, DEFAULT_DRAFT_PICKS).toFixed(1)
        );
        fireEvent.change(within(dialog).getByLabelText("Pick number"), {
            target: { value: String(DEFAULT_DRAFT_PICKS) },
        });
        expect(cap()).toBe(
            contextCapForPick(DEFAULT_DRAFT_PICKS, DEFAULT_DRAFT_PICKS).toFixed(
                1
            )
        );
    });

    it("dims a card the rating decides and brightens one the context can flip", () => {
        db = {
            [cardId("Lightning Bolt")]: 3,
            [cardId("Counterspell")]: 3,
            [cardId("Sol Ring")]: 0,
        };
        page.cards = build();
        const dialog = openPack();
        const flippable = (name: string) =>
            dialog
                .querySelector(
                    `[data-pick-rating-pack-card="${cardId(name)}"]`
                )!
                .getAttribute("data-flippable");
        const cap = contextCapForPick(1, DEFAULT_DRAFT_PICKS);
        expect(Math.abs(3 - 3) <= cap).toBe(true);
        expect(Math.abs(0 - 3) <= cap).toBe(false);
        expect(flippable("Counterspell")).toBe("true");
        expect(flippable("Sol Ring")).toBe("false");
    });

    it("clicking a pack card rates the open card half a point above it", () => {
        db = { [cardId("Counterspell")]: 3 };
        page.cards = build();
        const dialog = openPack();
        fireEvent.click(
            dialog.querySelector(
                `[data-pick-rating-pack-card="${cardId("Counterspell")}"]`
            )!
        );
        expect(page.setRating).toHaveBeenCalledWith({
            scope: "vintage-cube",
            cardId: cardId("Lightning Bolt"),
            rating: 3.5,
        });
    });

    it("the p key switches tabs", () => {
        render(<PickRatingsPage />);
        const dialog = openRow("Lightning Bolt");
        fireEvent.keyDown(window, { key: "p" });
        expect(dialog.querySelector("[data-pick-rating-cap]")).toBeTruthy();
        fireEvent.keyDown(window, { key: "p" });
        expect(dialog.querySelector("[data-pick-rating-cap]")).toBeNull();
    });
});

describe("rating dialog: keyboard and focus (issue #8909)", () => {
    it("digit keys rate even while a dialog control holds focus", () => {
        render(<PickRatingsPage />);
        const dialog = openRow("Lightning Bolt");
        const radio = within(dialog).getByRole("radio", { name: "Ladder" });
        fireEvent.keyDown(radio, { key: "4" });
        expect(page.setRating).toHaveBeenCalledWith({
            scope: "vintage-cube",
            cardId: cardId("Lightning Bolt"),
            rating: 4,
        });
    });

    it("Next hands no focus to a row behind the dialog", () => {
        render(<PickRatingsPage />);
        const dialog = openRow(tableOrder()[0]);
        fireEvent.click(within(dialog).getByRole("button", { name: "Next →" }));
        expect(document.activeElement?.id.startsWith("pick-rating-open-")).toBe(
            false
        );
    });

    it("shows a failed write instead of swallowing it", async () => {
        page.setRating = vi.fn().mockRejectedValue(new Error("Not an admin"));
        render(<PickRatingsPage />);
        const dialog = openRow("Lightning Bolt");
        fireEvent.click(
            within(dialog).getByRole("button", {
                name: "Rate Lightning Bolt 1.5",
            })
        );
        expect(await screen.findByRole("alert")).toBeTruthy();
    });
});
