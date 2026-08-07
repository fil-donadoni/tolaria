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
import {
    cardsIn,
    columnLabelsIn,
    paneOf,
} from "~/components/deckbuilder/__tests__/zoneQueries";

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

// Per-zone Grouping/Ordering controls (issue #1624). Grouping decides which
// Columns exist; Ordering decides the sequence INSIDE a column — orthogonal
// axes, each with its own control per zone (PRD #1617).
describe("DeckBuilder — per-zone Grouping/Ordering controls (issue #1624)", () => {
    it("each zone carries its OWN Grouping and Ordering controls, defaulting to Mana Value / Name", () => {
        const { getByLabelText } = renderBuilder();
        expect(
            (getByLabelText("Maindeck grouping") as HTMLSelectElement).value
        ).toBe("mv");
        expect(
            (getByLabelText("Maindeck ordering") as HTMLSelectElement).value
        ).toBe("name");
        expect(
            (getByLabelText("Sideboard grouping") as HTMLSelectElement).value
        ).toBe("mv");
        expect(
            (getByLabelText("Sideboard ordering") as HTMLSelectElement).value
        ).toBe("name");
    });

    it("changing the Maindeck's Grouping to Colour re-columns it into the WUBRG ladder, leaving the Sideboard untouched", () => {
        const { container, getByLabelText } = renderBuilder(
            deck([BOLT, SERRA], [PLAINS])
        );

        fireEvent.change(getByLabelText("Maindeck grouping"), {
            target: { value: "color" },
        });

        // `color` always emits the full fixed WUBRG + Multicolour +
        // Colourless ladder (like `mv`'s fixed ladder) — every column is a
        // valid drop target even while empty.
        expect(columnLabelsIn(paneOf(container, /^Maindeck /))).toEqual([
            "Lands",
            "White",
            "Blue",
            "Black",
            "Red",
            "Green",
            "Multicolour",
            "Colourless",
        ]);
        expect(cardsIn(container, "color:R")).toEqual(["Lightning Bolt"]);
        expect(cardsIn(container, "color:W")).toEqual(["Serra Angel"]);

        // The Sideboard never asked for this change — its own Grouping and
        // its own columns are exactly as they were.
        expect(
            (getByLabelText("Sideboard grouping") as HTMLSelectElement).value
        ).toBe("mv");
        expect(columnLabelsIn(paneOf(container, /^Sideboard /))).toEqual([
            "Lands",
        ]);
    });

    it("Grouping `type` shows one column per card type present, plus Lands", () => {
        const { container, getByLabelText } = renderBuilder(
            deck([SERRA, PLAINS], [])
        );

        fireEvent.change(getByLabelText("Maindeck grouping"), {
            target: { value: "type" },
        });

        expect(columnLabelsIn(paneOf(container, /^Maindeck /))).toEqual([
            "Lands",
            "Creature",
        ]);
    });

    it("Grouping `none` collapses the zone into a single column", () => {
        const { container, getByLabelText } = renderBuilder(
            deck([BOLT, SERRA, PLAINS], [])
        );

        fireEvent.change(getByLabelText("Maindeck grouping"), {
            target: { value: "none" },
        });

        expect(columnLabelsIn(paneOf(container, /^Maindeck /))).toEqual([
            "All",
        ]);
        expect(cardsIn(container, "all")).toEqual([
            "Lightning Bolt",
            "Plains",
            "Serra Angel",
        ]);
    });

    // The SIDEBOARD's own controls, driven for real (issue #1624 review
    // finding F2). Every other assertion in this block drives the Maindeck
    // and checks the Sideboard is "unchanged" — which a fully INERT
    // Sideboard control satisfies vacuously. These two are the positive
    // half: the Sideboard's own `<select>`s must actually re-column and
    // re-sequence the Sideboard.
    it("changing the SIDEBOARD's Grouping to Colour re-columns the Sideboard, leaving the Maindeck untouched", () => {
        const { container, getByLabelText } = renderBuilder(
            deck([BOLT], [SERRA, PLAINS])
        );
        // Pane model, so only the zone's NON-EMPTY columns render — under
        // `mv` that is Lands (Plains) + MV 5 (Serra).
        expect(columnLabelsIn(paneOf(container, /^Sideboard /))).toEqual([
            "Lands",
            "MV 5",
        ]);

        fireEvent.change(getByLabelText("Sideboard grouping"), {
            target: { value: "color" },
        });

        expect(columnLabelsIn(paneOf(container, /^Sideboard /))).toEqual([
            "Lands",
            "White",
        ]);
        expect(cardsIn(paneOf(container, /^Sideboard /), "color:W")).toEqual([
            "Serra Angel",
        ]);

        // The Maindeck never asked for this change.
        expect(
            (getByLabelText("Maindeck grouping") as HTMLSelectElement).value
        ).toBe("mv");
        expect(cardsIn(paneOf(container, /^Maindeck /), "mv:1")).toEqual([
            "Lightning Bolt",
        ]);
    });

    it("changing the SIDEBOARD's Ordering resequences the Sideboard's own column, leaving the Maindeck's order untouched", () => {
        const { container, getByLabelText } = renderBuilder(
            deck([SERRA, PLAINS], [BOLT, SERRA, PLAINS])
        );

        // Grouping `none` collapses the Sideboard into its single "All"
        // column, so any resequencing observed there is the Ordering axis
        // and nothing else.
        fireEvent.change(getByLabelText("Sideboard grouping"), {
            target: { value: "none" },
        });
        expect(cardsIn(paneOf(container, /^Sideboard /), "all")).toEqual([
            "Lightning Bolt",
            "Plains",
            "Serra Angel",
        ]);

        fireEvent.change(getByLabelText("Sideboard ordering"), {
            target: { value: "mv" },
        });

        expect(columnLabelsIn(paneOf(container, /^Sideboard /))).toEqual([
            "All",
        ]);
        expect(cardsIn(paneOf(container, /^Sideboard /), "all")).toEqual([
            "Plains",
            "Lightning Bolt",
            "Serra Angel",
        ]);

        // The Maindeck kept its own Grouping AND its own Ordering: still the
        // Mana-Value ladder, still by name inside each column.
        expect(
            (getByLabelText("Maindeck ordering") as HTMLSelectElement).value
        ).toBe("name");
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
    });

    it("Ordering resequences cards INSIDE a column without moving any card to a different column", () => {
        const { container, getByLabelText } = renderBuilder(
            deck([BOLT, SERRA, PLAINS], [])
        );

        // Grouping `none` puts every card in the one "All" column, so any
        // reordering observed here can only be the Ordering axis at work.
        fireEvent.change(getByLabelText("Maindeck grouping"), {
            target: { value: "none" },
        });
        expect(cardsIn(container, "all")).toEqual([
            "Lightning Bolt",
            "Plains",
            "Serra Angel",
        ]);

        fireEvent.change(getByLabelText("Maindeck ordering"), {
            target: { value: "mv" },
        });

        // Same single column, same three cards — only the SEQUENCE changed
        // (Plains and Lightning Bolt swap; Mana Value 0 sorts before 1).
        expect(columnLabelsIn(paneOf(container, /^Maindeck /))).toEqual([
            "All",
        ]);
        expect(cardsIn(container, "all")).toEqual([
            "Plains",
            "Lightning Bolt",
            "Serra Angel",
        ]);
    });
});

describe("DeckBuilder — Grouping round-trip preserves Card Pins, through the real controls (issue #1624)", () => {
    it("flipping Grouping to Colour and back to Mana Value restores a drag-recorded Pin exactly", async () => {
        const manager = new DragDropManager();
        const { container, getByTitle, getByLabelText } = renderBuilder(
            deck([BOLT], []),
            manager
        );

        // Pin Lightning Bolt into MV 6 via a real drag — NOT its auto MV 1.
        await dragOnto(
            manager,
            getByTitle(/Remove Lightning Bolt/),
            container.querySelector('[data-column="mv:6"]')!
        );
        expect(cardsIn(container, "mv:6")).toEqual(["Lightning Bolt"]);

        // Flip to Colour: the `mv` Pin lives in a DIFFERENT namespace, so it
        // simply does not apply here — the card falls back to its natural
        // Red column, exactly as an un-pinned card would.
        fireEvent.change(getByLabelText("Maindeck grouping"), {
            target: { value: "color" },
        });
        expect(cardsIn(container, "color:R")).toEqual(["Lightning Bolt"]);

        // Flip back to Mana Value: the ORIGINAL Pin must still be there —
        // this is the whole reason Pins are namespaced (ADR 0075 §3) rather
        // than recomputed or cleared on a Grouping switch.
        fireEvent.change(getByLabelText("Maindeck grouping"), {
            target: { value: "mv" },
        });
        expect(cardsIn(container, "mv:6")).toEqual(["Lightning Bolt"]);
        expect(cardsIn(container, "mv:1")).toEqual([]);
    });
});

// Per-zone build-time filter (PRD #1617, issue #1625, ADR 0075 § "Filter is
// momentary"). The `deck-zone-surface.test.tsx` suite covers the filter's
// own mechanics against `DeckZoneSurface` in isolation; this block is the
// integration proof — through the REAL two-zone `DeckBuilder` tree — that
// the filter changes only what's RENDERED and touches nothing a save or a
// legality check reads.
describe("DeckBuilder — per-zone build-time filter (issue #1625)", () => {
    it("hides a Maindeck card from its column without touching the Sideboard", () => {
        const { container, getByLabelText } = renderBuilder(
            deck([BOLT, SERRA], [PLAINS])
        );
        expect(cardsIn(container, "mv:1")).toEqual(["Lightning Bolt"]);

        fireEvent.click(getByLabelText("Maindeck colour W"));

        expect(cardsIn(container, "mv:1")).toEqual([]); // Bolt (Red) hidden
        expect(cardsIn(container, "mv:5")).toEqual(["Serra Angel"]); // Serra (W) stays
        expect(columnLabelsIn(paneOf(container, /^Sideboard /))).toEqual([
            "Lands",
        ]);
        expect(cardsIn(paneOf(container, /^Sideboard /), "mv:lands")).toEqual([
            "Plains",
        ]);
    });

    it("never changes the SAVED card count — SaveDeckBar reads the real Maindeck, not the filtered view", () => {
        const { getByLabelText, getByText } = renderBuilder(
            deck([BOLT, SERRA], [])
        );
        expect(getByText("2 cards")).toBeTruthy();

        fireEvent.click(getByLabelText("Maindeck colour W")); // hides Bolt from view
        expect(getByText("2 cards")).toBeTruthy(); // unchanged — nothing was removed
    });

    it("the Maindeck's filter never narrows the Sideboard's own filter, and vice versa", () => {
        const { container, getByLabelText } = renderBuilder(
            deck([BOLT], [BOLT, SERRA])
        );
        fireEvent.click(getByLabelText("Maindeck colour W"));

        // Maindeck: Bolt (Red) hidden by the White-only filter.
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
        expect(cardsIn(container, "mv:1")).toEqual([]);

        // Sideboard never had a filter applied — both its cards still show.
        expect(columnLabelsIn(paneOf(container, /^Sideboard /))).toEqual([
            "MV 1",
            "MV 5",
        ]);
    });
});

describe("DeckBuilder — Grouping/Ordering persist per-user via the view-preferences seam (issue #1624/#1620)", () => {
    it("persists a change to the shared deckViewPrefs key, and a fresh mount (any deck) picks it up", () => {
        const { getByLabelText, unmount } = renderBuilder();

        fireEvent.change(getByLabelText("Sideboard ordering"), {
            target: { value: "rarity" },
        });
        expect(
            window.localStorage.getItem("tolaria:deckViewPrefs:ordering:side")
        ).toBe(JSON.stringify("rarity"));

        unmount();

        // A fresh mount of a DIFFERENT deck reads the SAME per-user
        // preference — Grouping/Ordering are remembered for the user, not
        // scoped to one deck (PRD #1617 § "view preferences on the user").
        const { getByLabelText: getByLabelTextAgain } = renderBuilder(
            deck([], [])
        );
        expect(
            (getByLabelTextAgain("Sideboard ordering") as HTMLSelectElement)
                .value
        ).toBe("rarity");
    });
});
