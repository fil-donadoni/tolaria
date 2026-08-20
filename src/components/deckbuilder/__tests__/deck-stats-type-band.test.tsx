// The Stats dialog's type band (issue #2586, dataviz skill) — asserted from
// the REAL `computeDeckStats` model over real registry cards (same pattern
// as `src/lib/__tests__/deckStats.test.ts` and `deck-stats-button.test.tsx`),
// never a hand-built `{ Creature: 3, ... }` fixture: a fixture only proves
// the component renders numbers you already typed twice.
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { computeDeckStats } from "~/lib/deckStats";
import type { DeckCard } from "~/types/game";
import DeckStatsTypeBand from "../deck-stats-type-band";

// Real registry ids.
const GRIZZLY_BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // {1}{G}, Creature
const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56"; // basic land, Land
const MOX_RUBY = "8945585f-4773-493d-a0fe-d707db910b38"; // non-land rock, Artifact
const TARFIRE = "d13a898e-6a97-4fd9-980e-3bfd8d755386"; // lrw — Instant + Kindred (the catalogue's 9th CardType)

function deckOf(...cardIds: string[]): DeckCard[] {
    return cardIds.map((cardId) => ({ cardId, cardName: cardId }));
}

describe("DeckStatsTypeBand (issue #2586)", () => {
    it("renders one segment per present type, titled with the REAL computeDeckStats count", () => {
        const stats = computeDeckStats(
            deckOf(GRIZZLY_BEARS, MOUNTAIN, MOX_RUBY)
        );
        render(<DeckStatsTypeBand counts={stats.types} />);

        const band = screen.getByRole("group", {
            name: "Card types, share of type tags",
        });
        expect(
            within(band).getByTitle(`Artifact: ${stats.types.Artifact}`)
        ).toBeTruthy();
        expect(
            within(band).getByTitle(`Creature: ${stats.types.Creature}`)
        ).toBeTruthy();
        expect(
            within(band).getByTitle(`Land: ${stats.types.Land}`)
        ).toBeTruthy();

        // Legend mirrors the same three types + counts (dataviz skill: a
        // legend is mandatory once there are 2+ series, identity is never
        // color-alone).
        expect(screen.getByText("Artifact")).toBeTruthy();
        expect(screen.getByText("Creature")).toBeTruthy();
        expect(screen.getByText("Land")).toBeTruthy();
    });

    it("assigns segment DOM order by each type's FIXED catalogue slot, not by count", () => {
        // Two Mountains (Land: 2) outnumber the single Grizzly Bears
        // (Creature: 1), but Creature's fixed slot precedes Land's — a
        // count-sorted band would put Land first here.
        const stats = computeDeckStats(
            deckOf(MOUNTAIN, MOUNTAIN, GRIZZLY_BEARS)
        );
        render(<DeckStatsTypeBand counts={stats.types} />);

        const band = screen.getByRole("group", {
            name: "Card types, share of type tags",
        });
        const titles = within(band)
            .getAllByTitle(/^(Creature|Land): \d+$/)
            .map((el) => el.getAttribute("title"));
        expect(titles).toEqual(["Creature: 1", "Land: 2"]);
    });

    it("folds a CardType outside the 8-slot palette (Kindred) into a neutral 'Other' segment (dataviz skill: never a 9th generated hue)", () => {
        // Tarfire is `["Instant", "Kindred"]` — Instant gets its own fixed
        // slot; Kindred, the catalogue's 9th CardType, has none, so it must
        // fold into "Other" rather than generating a 9th categorical hue.
        const stats = computeDeckStats(deckOf(TARFIRE));
        expect(stats.types.Kindred).toBe(1); // sanity: the real model DID count it

        render(<DeckStatsTypeBand counts={stats.types} />);

        const band = screen.getByRole("group", {
            name: "Card types, share of type tags",
        });
        expect(within(band).getByTitle("Instant: 1")).toBeTruthy();
        expect(within(band).getByTitle("Other: 1")).toBeTruthy();
        // "Kindred" itself is never rendered as its own segment/legend label.
        expect(screen.queryByTitle(/^Kindred:/)).toBeNull();
    });

    it("renders the empty-Maindeck message when there are no counted types", () => {
        const stats = computeDeckStats([]);
        render(<DeckStatsTypeBand counts={stats.types} />);
        expect(screen.getByText("No cards in the Maindeck yet.")).toBeTruthy();
        expect(screen.queryByRole("group")).toBeNull();
    });
});
