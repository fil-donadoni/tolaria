// The CONSTRUCTED builder's deck zones, on the shared surface (issue #1622).
//
// Until this file, `DeckBuilder` had no render harness at all — the reason
// `deck-builder-height.test.ts` resorts to source-text assertions. But issue
// #1622 changes what a Constructed user SEES (fixed columns instead of only the
// non-empty Mana-Value piles; a columned, drop-targeted Sideboard; a draggable
// split), and the pin it records lives in `DeckBuilder`'s own working-deck
// state — none of which the shared-surface tests reach, because they mount the
// surface directly with a hand-supplied layout. So the harness gets built here:
// three module mocks (router + the two Convex `useQuery` call sites) are all
// `DeckBuilder` needs, and everything the assertions traverse is the real
// component, the real Column Layout engine and the real drag resolution.
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import { DragDropManager } from "@dnd-kit/dom";
import {
    dragOnto,
    installDndJsdomShims,
} from "~/components/deckbuilder/__tests__/dragHarness";

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => vi.fn(),
    useSearch: () => ({}),
}));

// `useBanlistOverride` and `DeckBanlistPanel` are the builder's only Convex
// readers; `undefined` is their real "still loading" value, which both already
// treat as "no override".
vi.mock("convex/react", () => ({ useQuery: () => undefined }));

import DeckBuilder from "../deck-builder";
import type { LobbyDeck } from "~/lib/deckTypes";

// Real registry ids — the Column Layout engine resolves each through the card
// registry, so their columns are the engine's real answer, not a fixture's.
const BOLT = {
    cardId: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
    cardName: "Lightning Bolt",
}; // MV 1
const SERRA = {
    cardId: "f8ac5006-91bd-4803-93da-f87cf196dd2f",
    cardName: "Serra Angel",
}; // MV 5
const PLAINS = {
    cardId: "b1623d57-4729-4796-b3f7-f1837a05c6ed",
    cardName: "Plains",
}; // land

const SPLIT_KEY = "tolaria:deckbuilderSplit:deckbuilder";

const sinks = {
    user: {
        create: vi.fn().mockResolvedValue("deck-1"),
        update: vi.fn().mockResolvedValue(undefined),
    },
    preset: {
        create: vi.fn().mockResolvedValue("slug"),
        update: vi.fn().mockResolvedValue(undefined),
    },
};

function deck(cards = [BOLT], sideboard = [PLAINS]): LobbyDeck {
    return {
        id: "deck-1",
        name: "Test Deck",
        format: "freeform",
        colors: [],
        cards,
        sideboard,
    } as unknown as LobbyDeck;
}

function renderBuilder(
    initialDeck: LobbyDeck | null = deck(),
    manager?: DragDropManager
) {
    return render(
        <DeckBuilder
            kind="user"
            initialDeck={initialDeck}
            initialIdentity="deck-1"
            initialDeckList={[]}
            sinks={sinks as never}
            onClose={() => {}}
            manager={manager}
        />
    );
}

/** The pane element of one zone — its header span's grandparent. */
function paneOf(container: HTMLElement, title: RegExp): HTMLElement {
    const span = [...container.querySelectorAll("span")].find((el) =>
        title.test(el.textContent ?? "")
    )!;
    return span.parentElement!.parentElement!;
}

/** Column labels of one zone, in render order, read off the real DOM. */
function columnLabelsIn(pane: HTMLElement): string[] {
    return [...pane.querySelectorAll("[data-column]")].map(
        (el) => el.querySelector("span")!.textContent!
    );
}

/** Card names in the Maindeck column whose Column id is `columnId`. */
function cardsIn(container: HTMLElement, columnId: string): string[] {
    const column = container.querySelector(`[data-column="${columnId}"]`)!;
    return [...column.querySelectorAll("[role=button][title]")].map((el) =>
        el
            .getAttribute("title")!
            .replace(/^Remove /, "")
            .replace(/ \(.*$/, "")
    );
}

beforeAll(installDndJsdomShims);
beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
});

describe("DeckBuilder — Constructed zones on the shared surface (issue #1622)", () => {
    it("renders the FULL fixed ladder in the Maindeck, not only the non-empty piles", () => {
        // Before #1622 this deck rendered exactly `Lands | MV 1 | MV 5`; the
        // point of the rewire is that every column now exists as a drop target.
        const { container } = renderBuilder(deck([BOLT, SERRA, PLAINS], []));
        expect(columnLabelsIn(paneOf(container, /^Maindeck /))).toEqual([
            "Lands",
            "MV 0",
            "MV 1",
            "MV 2",
            "MV 3",
            "MV 4",
            "MV 5",
            "MV 6",
            "MV 7+",
        ]);
        expect(cardsIn(container, "mv:lands")).toEqual(["Plains"]);
        expect(cardsIn(container, "mv:1")).toEqual(["Lightning Bolt"]);
        expect(cardsIn(container, "mv:5")).toEqual(["Serra Angel"]);
    });

    it("columns the Sideboard too — it was one flat drop area before #1622", () => {
        const { container } = renderBuilder(deck([], [BOLT, PLAINS]));
        expect(columnLabelsIn(paneOf(container, /^Sideboard /))).toEqual([
            "Lands",
            "MV 1",
        ]);
    });

    it("keeps the Sideboard's 0–15 count suffix, with no warning under the cap", () => {
        const { getByText, queryByText } = renderBuilder(deck([], [PLAINS]));
        expect(getByText(/^Sideboard 1\/15$/)).toBeTruthy();
        expect(queryByText("over limit")).toBeNull();
    });

    it("warns once the Sideboard is over the 15-card limit", () => {
        // Limited's Sideboard is uncapped by design — `sideCountSuffix` and
        // `sideWarning` are wired ONLY by this builder, so this is the
        // assertion that keeps the shared surface from flattening the two.
        const { getByText } = renderBuilder(
            deck(
                [],
                Array.from({ length: 16 }, () => PLAINS)
            )
        );
        expect(getByText(/^Sideboard 16\/15$/)).toBeTruthy();
        expect(getByText("over limit")).toBeTruthy();
    });

    it("renders the draggable split handle and both independent zoom sliders", () => {
        const { getByLabelText } = renderBuilder();
        expect(getByLabelText("Resize Maindeck and Sideboard")).toBeTruthy();
        const main = getByLabelText("Maindeck card size") as HTMLInputElement;
        const side = getByLabelText("Sideboard card size") as HTMLInputElement;
        // Independent multipliers: moving one must not move the other.
        fireEvent.change(main, { target: { value: "2" } });
        expect(main.value).toBe("2");
        expect(side.value).not.toBe("2");
    });

    it("persists the split ratio under the Constructed builder's OWN key", () => {
        // Pre-#1622 there was no split in this builder at all, so there was no
        // key either — and it must not share the Limited builder's `…:pool`.
        window.localStorage.setItem(SPLIT_KEY, "0.4");
        const { container } = renderBuilder();
        const split = container.querySelector(
            "[style*='--split-main']"
        ) as HTMLElement;
        expect(split.style.getPropertyValue("--split-main")).toBe("40%");
        expect(
            window.localStorage.getItem("tolaria:deckbuilderSplit:pool")
        ).toBeNull();
    });

    it("still offers Featured Card selection in the Maindeck", () => {
        const { container } = renderBuilder(deck([BOLT, SERRA], []));
        // With no override the resolver features the first Maindeck card.
        const bolt = container.querySelector('[data-column="mv:1"]')!;
        const serra = container.querySelector('[data-column="mv:5"]')!;
        expect(
            within(bolt as HTMLElement).getByTitle(
                "Featured card — click to clear"
            )
        ).toBeTruthy();

        // Picking the other card moves the indicator — the affordance is live,
        // not merely rendered.
        fireEvent.click(
            within(serra as HTMLElement).getByTitle("Set as featured card")
        );
        expect(
            within(serra as HTMLElement).getByTitle(
                "Featured card — click to clear"
            )
        ).toBeTruthy();
        expect(
            within(bolt as HTMLElement).getByTitle("Set as featured card")
        ).toBeTruthy();
    });
});

describe("DeckBuilder — Constructed mounted drag (issue #1622)", () => {
    it("dragging a Maindeck card onto another column pins it there, and the pin survives a re-render", async () => {
        const manager = new DragDropManager();
        const { container, getByTitle } = renderBuilder(
            deck([BOLT], []),
            manager
        );
        expect(cardsIn(container, "mv:1")).toEqual(["Lightning Bolt"]);

        await dragOnto(
            manager,
            getByTitle(/Remove Lightning Bolt/),
            container.querySelector('[data-column="mv:6"]')!
        );

        expect(cardsIn(container, "mv:1")).toEqual([]);
        expect(cardsIn(container, "mv:6")).toEqual(["Lightning Bolt"]);

        // The pin lives in the working deck (unpersisted in this slice), so it
        // must survive any unrelated re-render — here, editing the deck name.
        fireEvent.change(
            getByTitle(/Remove Lightning Bolt/).ownerDocument.querySelector(
                "input[type=text]"
            ) as HTMLInputElement,
            {
                target: { value: "Renamed" },
            }
        );
        expect(cardsIn(container, "mv:6")).toEqual(["Lightning Bolt"]);
    });

    it("dragging a Sideboard card onto a Maindeck column moves it in AND pins it, in one gesture", async () => {
        const manager = new DragDropManager();
        const { container, getByTitle } = renderBuilder(
            deck([], [BOLT]),
            manager
        );
        const sideboard = paneOf(container, /^Sideboard /);
        expect(columnLabelsIn(sideboard)).toEqual(["MV 1"]);

        await dragOnto(
            manager,
            getByTitle(/Remove Lightning Bolt/),
            container.querySelector('[data-column="mv:lands"]')!
        );

        // Moved into the Maindeck…
        expect(columnLabelsIn(paneOf(container, /^Sideboard /))).toEqual([]);
        // …and pinned to the Lands column it was dropped on, not its auto MV 1.
        expect(cardsIn(container, "mv:lands")).toEqual(["Lightning Bolt"]);
        expect(cardsIn(container, "mv:1")).toEqual([]);
    });

    it("dragging a Maindeck card onto the Sideboard moves it out of the deck", async () => {
        const manager = new DragDropManager();
        const { container, getByTitle } = renderBuilder(
            deck([BOLT], []),
            manager
        );

        await dragOnto(
            manager,
            getByTitle(/Remove Lightning Bolt/),
            paneOf(container, /^Sideboard /)
        );

        expect(cardsIn(container, "mv:1")).toEqual([]);
        expect(
            within(paneOf(container, /^Sideboard /)).getByTitle(
                /Remove Lightning Bolt/
            )
        ).toBeTruthy();
    });
});
