// Manual Columns, delete-only-while-empty, and the layout persisting ON THE
// DECK (ADR 0075 §2/§4, PRD #1617 stories 17–22 and 28, issue #1626).
//
// Mounted on the REAL `DeckBuilder`, for the same reason
// `deck-builder-zones.test.tsx` builds this harness: the column gestures write
// to the builder's own working deck and are read back through the real Column
// Layout engine, so a test that mounts the zone surface with a hand-supplied
// layout would assert on a fixture instead of on the feature. Three module
// mocks (router + the two Convex `useQuery` call sites) are all `DeckBuilder`
// needs; everything the assertions traverse is real.
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, fireEvent, waitFor, within } from "@testing-library/react";
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
import { COLUMN_DELETE_BLOCKED_REASON } from "~/components/deckbuilder/deck-column-actions";

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => vi.fn(),
    useSearch: () => ({}),
}));

vi.mock("convex/react", () => ({ useQuery: () => undefined }));

import DeckBuilder from "../deck-builder";
import type { LobbyDeck } from "~/lib/deckTypes";

// Real registry ids — every column these land in is the engine's real answer.
const BOLT = {
    cardId: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
    cardName: "Lightning Bolt",
}; // MV 1, red instant
const SERRA = {
    cardId: "f8ac5006-91bd-4803-93da-f87cf196dd2f",
    cardName: "Serra Angel",
}; // MV 5, white creature

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

function deck(
    cards = [BOLT],
    sideboard: (typeof BOLT)[] = [],
    layout?: LobbyDeck["layout"]
): LobbyDeck {
    return {
        id: "deck-1",
        name: "Test Deck",
        format: "freeform",
        colors: [],
        cards,
        sideboard,
        layout,
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

/** Adds a manual Column through the real affordance. */
function addColumn(
    rendered: ReturnType<typeof render>,
    label: string,
    zone = "Maindeck"
) {
    fireEvent.click(rendered.getByLabelText(`Add ${zone} column`));
    fireEvent.change(rendered.getByLabelText(`New ${zone} column name`), {
        target: { value: label },
    });
    fireEvent.click(rendered.getByLabelText(`Create ${zone} column`));
}

function mainPane(container: HTMLElement) {
    return paneOf(container, /^Maindeck /);
}

beforeAll(installDndJsdomShims);
beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
});

describe("DeckBuilder — manual Columns (ADR 0075 §2, issue #1626)", () => {
    it("an add-column affordance creates a NAMED column, last before the Catch-All", () => {
        const rendered = renderBuilder();
        expect(columnLabelsIn(mainPane(rendered.container))).not.toContain(
            "Removal"
        );

        addColumn(rendered, "Removal");

        const labels = columnLabelsIn(mainPane(rendered.container));
        expect(labels).toContain("Removal");
        // Manual Columns render after the generated ladder; the Catch-All is
        // last of all, and stays hidden while empty.
        expect(labels[labels.length - 1]).toBe("Removal");
        expect(
            rendered.container.querySelector('[data-column="custom:removal"]')
        ).toBeTruthy();
    });

    it("nothing lands in a manual column on its own — only a drag puts a card there", async () => {
        const manager = new DragDropManager();
        const rendered = renderBuilder(deck([BOLT]), manager);
        addColumn(rendered, "Removal");

        // Bolt is still claimed by its predicate column, not by the brand-new
        // manual one: a manual Column carries NO predicate.
        expect(cardsIn(rendered.container, "custom:removal")).toEqual([]);
        expect(cardsIn(rendered.container, "mv:1")).toEqual(["Lightning Bolt"]);

        await dragOnto(
            manager,
            rendered.getByTitle(/Remove Lightning Bolt/),
            rendered.container.querySelector('[data-column="custom:removal"]')!
        );

        expect(cardsIn(rendered.container, "custom:removal")).toEqual([
            "Lightning Bolt",
        ]);
        expect(cardsIn(rendered.container, "mv:1")).toEqual([]);
    });

    it("a manual column — and the `custom` pin in it — survives every Grouping", async () => {
        const manager = new DragDropManager();
        const rendered = renderBuilder(deck([BOLT]), manager);
        addColumn(rendered, "Removal");
        await dragOnto(
            manager,
            rendered.getByTitle(/Remove Lightning Bolt/),
            rendered.container.querySelector('[data-column="custom:removal"]')!
        );

        for (const grouping of ["color", "type", "none", "mv"]) {
            fireEvent.change(rendered.getByLabelText("Maindeck grouping"), {
                target: { value: grouping },
            });
            expect(columnLabelsIn(mainPane(rendered.container))).toContain(
                "Removal"
            );
            // A `custom` Pin outranks the active Grouping's generated
            // predicate under EVERY Grouping (ADR 0075 §2 claiming order) —
            // including `none`, whose single column claims everything else.
            expect(cardsIn(rendered.container, "custom:removal")).toEqual([
                "Lightning Bolt",
            ]);
        }
    });

    it("a manual column can be renamed, keeping the cards pinned into it", async () => {
        const manager = new DragDropManager();
        const rendered = renderBuilder(deck([BOLT]), manager);
        addColumn(rendered, "Removal");
        await dragOnto(
            manager,
            rendered.getByTitle(/Remove Lightning Bolt/),
            rendered.container.querySelector('[data-column="custom:removal"]')!
        );

        fireEvent.click(rendered.getByLabelText("Rename column Removal"));
        fireEvent.change(rendered.getByLabelText("Rename column Removal"), {
            target: { value: "Burn" },
        });
        fireEvent.click(
            rendered.getByLabelText("Save name for column Removal")
        );

        expect(columnLabelsIn(mainPane(rendered.container))).toContain("Burn");
        // The ID is what a Pin names, so it must NOT be re-slugged: the card
        // is still in the same column.
        expect(cardsIn(rendered.container, "custom:removal")).toEqual([
            "Lightning Bolt",
        ]);
    });

    it("only a MANUAL column offers a rename — a generated one's label comes from its Grouping", () => {
        const rendered = renderBuilder();
        addColumn(rendered, "Removal");
        expect(rendered.queryByLabelText("Rename column Removal")).toBeTruthy();
        expect(rendered.queryByLabelText("Rename column MV 1")).toBeNull();
    });
});

describe("DeckBuilder — deleting a column (ADR 0075 §2, issue #1626)", () => {
    it("refuses to delete a column holding a card, and SHOWS the reason", () => {
        const rendered = renderBuilder(deck([BOLT]));
        const button = rendered.getByLabelText(
            `Cannot delete column MV 1. ${COLUMN_DELETE_BLOCKED_REASON}`
        );
        expect((button as HTMLButtonElement).disabled).toBe(true);
        // The reason is on the control the player reaches for, not buried in
        // a console message or a silent no-op.
        expect(button.getAttribute("title")).toBe(COLUMN_DELETE_BLOCKED_REASON);
        // An EMPTY column, by contrast, offers a live delete.
        expect(
            (rendered.getByLabelText("Delete column MV 3") as HTMLButtonElement)
                .disabled
        ).toBe(false);
    });

    it("deletes an empty column, and it stays gone", () => {
        const rendered = renderBuilder(deck([BOLT]));
        fireEvent.click(rendered.getByLabelText("Delete column MV 3"));

        const labels = columnLabelsIn(mainPane(rendered.container));
        expect(labels).not.toContain("MV 3");
        expect(labels).toContain("MV 2");
        expect(labels).toContain("MV 4");
    });

    it("a card that WOULD have matched a deleted column lands in the Catch-All", () => {
        // PRD #1617 story 22 — "deleting the empty MV 5 column does not make a
        // later 5-drop vanish". Here the deletion is one the deck was SAVED
        // with, and the 5-drop is in the deck: the card is claimed by nothing,
        // so the Catch-All takes it and it stays visible.
        const rendered = renderBuilder(
            deck([BOLT, SERRA], [], {
                maindeck: { removedColumnIds: ["mv:5"] },
            })
        );
        const labels = columnLabelsIn(mainPane(rendered.container));
        expect(labels).not.toContain("MV 5");
        expect(labels.at(-1)).toBe("Catch-All");
        expect(cardsIn(rendered.container, "catch-all")).toEqual([
            "Serra Angel",
        ]);
        expect(cardsIn(rendered.container, "mv:1")).toEqual(["Lightning Bolt"]);
    });

    it("the Catch-All is never deletable and never renameable", () => {
        // It only renders while it holds something, so open a deck whose
        // saved layout has already deleted the column Serra would sit in.
        const rendered = renderBuilder(
            deck([SERRA], [], { maindeck: { removedColumnIds: ["mv:5"] } })
        );

        expect(cardsIn(rendered.container, "catch-all")).toEqual([
            "Serra Angel",
        ]);
        expect(columnLabelsIn(mainPane(rendered.container)).at(-1)).toBe(
            "Catch-All"
        );
        expect(
            rendered.queryByLabelText(/delete column Catch-All/i)
        ).toBeNull();
        expect(
            rendered.queryByLabelText(/rename column Catch-All/i)
        ).toBeNull();
    });
});

describe("DeckBuilder — the layout persists on the deck (ADR 0075 §4, issue #1626)", () => {
    it("saves manual columns and pins through the deck's own autosave", async () => {
        const manager = new DragDropManager();
        const rendered = renderBuilder(deck([BOLT]), manager);
        addColumn(rendered, "Removal");
        await dragOnto(
            manager,
            rendered.getByTitle(/Remove Lightning Bolt/),
            rendered.container.querySelector('[data-column="custom:removal"]')!
        );
        // Leaving the screen flushes the debounced save.
        rendered.unmount();

        await waitFor(() => expect(sinks.user.update).toHaveBeenCalled());
        const [, payload] = sinks.user.update.mock.calls.at(-1)!;
        expect(payload.layout).toEqual({
            maindeck: {
                manualColumns: [{ id: "custom:removal", label: "Removal" }],
                pins: { [BOLT.cardId]: { custom: "custom:removal" } },
            },
        });
        // Saving the layout never alters deck CONTENTS (issue #1626 AC).
        expect(payload.cards).toEqual([BOLT]);
        expect(payload.sideboard).toEqual([]);
    });

    it("in Constructed, pinning a card pins EVERY copy of it", async () => {
        const manager = new DragDropManager();
        const rendered = renderBuilder(deck([BOLT, BOLT, BOLT]), manager);
        addColumn(rendered, "Removal");
        await dragOnto(
            manager,
            within(
                rendered.container.querySelector('[data-column="mv:1"]')!
            ).getAllByTitle(/Remove Lightning Bolt/)[0],
            rendered.container.querySelector('[data-column="custom:removal"]')!
        );
        // All three copies move together — the Constructed Pin is keyed by
        // Card ID (ADR 0075 §4).
        expect(cardsIn(rendered.container, "custom:removal")).toEqual([
            "Lightning Bolt",
            "Lightning Bolt",
            "Lightning Bolt",
        ]);
    });

    it("reopening the deck restores the saved manual columns and pins", () => {
        // The other half of "it persists": a deck row that ALREADY carries a
        // layout renders it, with no gesture at all.
        const rendered = renderBuilder(
            deck([BOLT], [], {
                maindeck: {
                    manualColumns: [{ id: "custom:removal", label: "Removal" }],
                    removedColumnIds: ["mv:3"],
                    pins: { [BOLT.cardId]: { custom: "custom:removal" } },
                },
            })
        );
        const labels = columnLabelsIn(mainPane(rendered.container));
        expect(labels).toContain("Removal");
        expect(labels).not.toContain("MV 3");
        expect(cardsIn(rendered.container, "custom:removal")).toEqual([
            "Lightning Bolt",
        ]);
    });

    it("a deck saved BEFORE this slice loads with no layout and never grows one", async () => {
        // The no-migration guarantee: editing such a deck's cards must leave
        // its stored row without a `layout` field entirely.
        const rendered = renderBuilder(deck([BOLT], []));
        expect(columnLabelsIn(mainPane(rendered.container))).toEqual([
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
        // Remove the card — a plain contents edit.
        fireEvent.click(rendered.getByTitle(/Remove Lightning Bolt/));
        rendered.unmount();

        await waitFor(() => expect(sinks.user.update).toHaveBeenCalled());
        const [, payload] = sinks.user.update.mock.calls.at(-1)!;
        expect(payload.layout).toBeUndefined();
    });
});
