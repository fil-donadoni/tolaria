// Stats dialog (PRD #1617 § "Stats dialog", issue #1631) — mounted through
// the REAL toolbar button, per the project's frontend-wiring discipline: a
// hand-built dialog render would mask the button never actually mounting it.
// `DeckStatsButton` IS the toolbar action every deckbuilder wrapper puts in
// its `headerActions` slot, so rendering it directly is rendering the real
// affordance, not a stand-in for it.
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { ZoneCard } from "~/types/game";
import DeckStatsButton from "../deck-stats-button";

// Real registry ids, reused from `deck-builder-shell.test.tsx`.
const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt — {R}, Instant
const MOUNTAIN_ID = "eace2c85-976c-425e-9800-5a6ccbd91b56"; // Mountain — land, produces R
const SERRA_ID = "f8ac5006-91bd-4803-93da-f87cf196dd2f"; // Serra Angel — Creature

function card(cardId: string, cardName = cardId): ZoneCard {
    return { cardId, cardName };
}

describe("DeckStatsButton — Stats dialog (issue #1631)", () => {
    it("opens the dialog from the toolbar button, not rendered inline before the click", () => {
        render(
            <DeckStatsButton mainCards={[card(BOLT_ID, "Lightning Bolt")]} />
        );
        expect(screen.queryByText("Deck Statistics")).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "Stats" }));
        expect(screen.getByText("Deck Statistics")).toBeTruthy();
    });

    it("charts a curve bucket, shows a pip/source pair, and lists a type count — all from computeDeckStats", () => {
        render(
            <DeckStatsButton
                mainCards={[
                    card(BOLT_ID, "Lightning Bolt"),
                    card(MOUNTAIN_ID, "Mountain"),
                ]}
            />
        );
        fireEvent.click(screen.getByRole("button", { name: "Stats" }));

        // Curve: Lightning Bolt is MV 1, lands excluded — bucket "1" carries
        // count 1 (Mountain contributes nothing to the curve bucket).
        expect(screen.getByTitle("Mana value 1: 1 card")).toBeTruthy();

        // Pips vs. sources: Lightning Bolt's {R} pip next to Mountain's R
        // source, in one row.
        expect(screen.getByText("1 pip")).toBeTruthy();
        expect(screen.getByText(/1 source \(1 land \+ 0 other\)/)).toBeTruthy();

        // Type count: Lightning Bolt is an Instant, Mountain is a Land.
        expect(screen.getByText("Instant")).toBeTruthy();
        expect(screen.getByText("Land")).toBeTruthy();
    });

    it("reflects the Maindeck only — a card sitting in the Sideboard moves no number, and moving it into the Maindeck updates every number live", () => {
        // Mountain starts OUT of the passed list entirely, standing in for
        // "still in the Sideboard" (the button only ever receives the
        // Maindeck, mirroring both real wrappers).
        const { rerender } = render(
            <DeckStatsButton mainCards={[card(BOLT_ID, "Lightning Bolt")]} />
        );
        fireEvent.click(screen.getByRole("button", { name: "Stats" }));

        expect(screen.getByText("1 pip")).toBeTruthy();
        expect(
            screen.getByText(/0 sources \(0 lands \+ 0 other\)/)
        ).toBeTruthy();
        expect(screen.queryByText("Land")).toBeNull();

        // Moving Mountain from Sideboard to Maindeck: the wrapper now passes
        // it in `mainCards`. Every number must update live off the new prop.
        rerender(
            <DeckStatsButton
                mainCards={[
                    card(BOLT_ID, "Lightning Bolt"),
                    card(MOUNTAIN_ID, "Mountain"),
                ]}
            />
        );

        expect(screen.getByText(/1 source \(1 land \+ 0 other\)/)).toBeTruthy();
        expect(screen.getByText("Land")).toBeTruthy();
    });

    it("orders Types by count descending, then alphabetically on a tie (issue #1631 fixup F4)", () => {
        // Two Mountains (Land: 2), one Serra Angel (Creature: 1), one
        // Lightning Bolt (Instant: 1) — Creature and Instant tie at count 1,
        // so the expected order (Land, Creature, Instant) can only come from
        // BOTH comparator terms: count-descending puts Land first, and
        // alphabetical tie-break puts Creature ahead of Instant. Inverting
        // either term in `DeckStatsTypeList`'s comparator breaks this.
        render(
            <DeckStatsButton
                mainCards={[
                    card(MOUNTAIN_ID, "Mountain"),
                    card(MOUNTAIN_ID, "Mountain"),
                    card(SERRA_ID, "Serra Angel"),
                    card(BOLT_ID, "Lightning Bolt"),
                ]}
            />
        );
        fireEvent.click(screen.getByRole("button", { name: "Stats" }));

        const typesSection = screen.getByText("Types").closest("section")!;
        const names = within(typesSection)
            .getAllByRole("listitem")
            .map((li) => li.querySelector("span")!.textContent);
        expect(names).toEqual(["Land", "Creature", "Instant"]);
    });
});
