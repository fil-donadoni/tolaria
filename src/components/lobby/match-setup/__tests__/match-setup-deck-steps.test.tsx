// Steps 4–5's wiring (PRD #5334 stories 29–39, issue #5341): the grid offers
// only the decks the Match Format admits, an illegal deck cannot be picked,
// and step 5 always offers Mirror — preselected when nothing is stored. The
// grid's rules themselves are `src/lib/__tests__/matchSetupDeckGrid.test.ts`.
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { LobbyDeck } from "~/lib/deckTypes";
import { applyChange, loadSetup, type MatchSetup } from "~/lib/matchSetup";
import MatchSetupPanes from "../match-setup-panes";

function deck(overrides: Partial<LobbyDeck>): LobbyDeck {
    return {
        kind: "preset",
        presetId: "deck",
        name: "Deck",
        format: "premodern",
        colors: ["R"],
        cards: [],
        sideboard: [],
        featuredCardId: null,
        isLegal: true,
        reasons: [],
        ...overrides,
    } as LobbyDeck;
}

const DECKS = [
    deck({ presetId: "burn", name: "Burn" }),
    deck({ presetId: "atog", name: "Atog", format: "old-school" }),
    deck({
        presetId: "broken",
        name: "Broken",
        isLegal: false,
        reasons: [{ code: "size", message: "Main deck has 12 cards" }],
    } as Partial<LobbyDeck>),
];

function Harness({ initial }: { initial: MatchSetup }) {
    const [setup, setSetup] = useState(initial);
    return (
        <MatchSetupPanes
            setup={setup}
            decks={DECKS}
            onChange={(patch) => setSetup((s) => applyChange(s, patch, DECKS))}
            canStart={false}
            busy={false}
            error={null}
            onStart={() => {}}
        />
    );
}

const gridDecks = () =>
    [...document.querySelectorAll("[data-grid-deck]")].map((el) =>
        el.getAttribute("data-grid-deck")
    );

const tileButton = (id: string) =>
    document.querySelector<HTMLButtonElement>(
        `[data-grid-deck="${id}"] [data-deck-select]`
    )!;

const mirror = () =>
    document.querySelector<HTMLButtonElement>("[data-mirror-choice] button")!;

/** Nothing stored: the setup a first visit opens on, answered to step 4. */
const firstVisit = (patch: Partial<MatchSetup>): MatchSetup => ({
    ...loadSetup(),
    mode: "arena",
    opponent: "bot",
    matchFormat: "premodern",
    ...patch,
});

beforeEach(() => localStorage.clear());

describe("step 4 — your deck", () => {
    it("shows only the decks the Match Format admits", () => {
        render(<Harness initial={firstVisit({})} />);
        expect(gridDecks()).toEqual(["burn", "broken"]);
    });

    it("an illegal deck is shown, flagged with its reason, not selectable", () => {
        render(<Harness initial={firstVisit({})} />);
        expect(tileButton("broken").disabled).toBe(true);
        expect(screen.getByText("Main deck has 12 cards")).toBeTruthy();
        expect(tileButton("burn").disabled).toBe(false);
    });

    it("picking a deck moves on to step 5", () => {
        render(<Harness initial={firstVisit({})} />);
        fireEvent.click(tileButton("burn"));
        expect(
            document.querySelector('[data-slot="panel-title"]')?.textContent
        ).toBe("Bot deck & difficulty");
    });
});

describe("step 5 — the Bot's deck", () => {
    it("offers Mirror, preselected when nothing is stored", () => {
        render(<Harness initial={firstVisit({ myDeckId: "burn" })} />);
        expect(mirror().getAttribute("aria-pressed")).toBe("true");
        expect(
            screen.getByRole("radiogroup", { name: "Bot difficulty" })
        ).toBeTruthy();
    });

    it("choosing a deck un-presses Mirror; Mirror stays offered", () => {
        render(<Harness initial={firstVisit({ myDeckId: "burn" })} />);
        fireEvent.click(tileButton("burn"));
        expect(mirror().getAttribute("aria-pressed")).toBe("false");
        expect(
            document
                .querySelector('[data-grid-deck="burn"] [data-deck-tile]')
                ?.getAttribute("data-selected")
        ).toBe("true");
    });

    it("Solo chooses the second seat's deck with no difficulty", () => {
        render(
            <Harness
                initial={firstVisit({ opponent: "solo", myDeckId: "burn" })}
            />
        );
        expect(mirror()).toBeTruthy();
        expect(
            screen.queryByRole("radiogroup", { name: "Bot difficulty" })
        ).toBeNull();
    });
});
