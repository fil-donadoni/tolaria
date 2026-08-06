// ONE user flow, asserted once per wrapper (issue #1623 AC: "the mounted-shell
// test asserts the same user flow once per wrapper").
//
// This is the test the slice exists for. `DeckBuilderShell` guarantees the two
// deckbuilders are the same screen BY CONSTRUCTION — but "by construction" is
// a claim about the code, and the thing a user notices is the rendered screen.
// So the flow body below is written ONCE and driven twice, through the REAL
// `DeckBuilder` (Constructed) and the REAL `PoolDeckBuilderForm` (Limited),
// each mounted exactly as its route mounts it. Two copies of the assertions
// would have let the surfaces drift again the moment one copy was edited; a
// shared body cannot.
//
// Everything the flow touches is real: the real wrappers, the real shell, the
// real Column Layout engine, the real drag resolution through dnd-kit's own
// manager (`dragHarness`). Only the transport is mocked — the router and the
// two Convex entry points — exactly as the pre-existing per-builder mount
// tests mock them.
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import { DragDropManager } from "@dnd-kit/dom";
import { dragOnto, installDndJsdomShims } from "./dragHarness";

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => vi.fn(),
    useSearch: () => ({}),
}));

vi.mock("convex/react", () => ({
    // `undefined` is the real "still loading" value of the builder's only
    // queries (`useBanlistOverride`, `DeckBanlistPanel`); both treat it as
    // "no override".
    useQuery: () => undefined,
    useMutation: () => vi.fn().mockResolvedValue("deck-1"),
}));

vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

import DeckBuilder from "~/components/lobby/deck-builder/deck-builder";
import PoolDeckBuilderForm from "../pool-deck-builder-form";
import type { LobbyDeck } from "~/lib/deckTypes";

// Real registry ids — every column below is the Column Layout engine's real
// answer for the real card, not a fixture's.
const BOLT = {
    cardId: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
    cardName: "Lightning Bolt",
}; // MV 1
const PLAINS = {
    cardId: "b1623d57-4729-4796-b3f7-f1837a05c6ed",
    cardName: "Plains",
}; // land

/** One deckbuilder variant, mounted the way its own route mounts it. */
interface Wrapper {
    name: string;
    title: string;
    /** Matches the Sideboard pane's header line. */
    sidePane: RegExp;
    /** The `localStorage` split key this variant must persist under — the two
     *  are distinct on purpose (issue #1622); a shared key would silently
     *  merge two independent saved layouts. */
    splitKey: string;
    /** Maindeck = [Lightning Bolt], Sideboard = [Plains]. */
    render: (manager?: DragDropManager) => ReturnType<typeof render>;
}

const constructed: Wrapper = {
    name: "Constructed (DeckBuilder)",
    title: "Edit Deck",
    sidePane: /^Sideboard /,
    splitKey: "tolaria:deckbuilderSplit:deckbuilder",
    render: (manager) =>
        render(
            <DeckBuilder
                kind="user"
                initialDeck={
                    {
                        id: "deck-1",
                        name: "Test Deck",
                        format: "freeform",
                        colors: [],
                        cards: [BOLT],
                        sideboard: [PLAINS],
                    } as unknown as LobbyDeck
                }
                initialIdentity="deck-1"
                initialDeckList={[]}
                sinks={
                    {
                        user: {
                            create: vi.fn().mockResolvedValue("deck-1"),
                            update: vi.fn().mockResolvedValue(undefined),
                        },
                        preset: {
                            create: vi.fn().mockResolvedValue("slug"),
                            update: vi.fn().mockResolvedValue(undefined),
                        },
                    } as never
                }
                onClose={() => {}}
                manager={manager}
            />
        ),
};

const limited: Wrapper = {
    name: "Limited (PoolDeckBuilderForm)",
    title: "Build Limited Deck",
    sidePane: /^Pool \(Sideboard\) /,
    splitKey: "tolaria:deckbuilderSplit:pool",
    render: (manager) =>
        render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={[
                    { scryfallId: "s1", ...BOLT },
                    { scryfallId: "s2", ...PLAINS },
                ]}
                existingDeck={
                    {
                        userDeckId: "deck-1",
                        name: "Test Deck",
                        cards: [BOLT],
                        sideboard: [PLAINS],
                    } as never
                }
                eventType="draft"
                poolArrangement={[]}
                manager={manager}
            />
        ),
};

/** Card names inside one Column, read off the real rendered DOM. */
function cardsIn(container: HTMLElement, columnId: string): string[] {
    const column = container.querySelector(`[data-column="${columnId}"]`);
    if (!column) return [];
    return [...column.querySelectorAll("[role=button][title]")].map((el) =>
        el
            .getAttribute("title")!
            .replace(/^Remove /, "")
            .replace(/ \(.*$/, "")
    );
}

/** A zone's pane element — its header span's grandparent. */
function paneOf(container: HTMLElement, title: RegExp): HTMLElement {
    const span = [...container.querySelectorAll("span")].find((el) =>
        title.test(el.textContent ?? "")
    )!;
    return span.parentElement!.parentElement!;
}

/** Column labels of one zone, in render order. */
function columnLabelsIn(pane: HTMLElement): string[] {
    return [...pane.querySelectorAll("[data-column]")].map(
        (el) => el.querySelector("span")!.textContent!
    );
}

beforeAll(installDndJsdomShims);
beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
});

describe.each([constructed, limited])(
    "deckbuilder parity — $name (issue #1623)",
    (wrapper: Wrapper) => {
        it("renders the whole shell: header, both zones on the fixed ladder, the split, both zoom sliders, the legality panel and the save bar", () => {
            const { container, getByText, getByLabelText, getByDisplayValue } =
                wrapper.render();

            // Header band — one per screen, carrying the variant's title.
            expect(
                container.querySelectorAll("[data-deckbuilder-header]")
            ).toHaveLength(1);
            expect(getByText(wrapper.title)).toBeTruthy();

            // Maindeck: the FULL fixed ladder, empty columns included, because
            // an empty column is exactly where a card gets dropped.
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
            expect(cardsIn(container, "mv:1")).toEqual(["Lightning Bolt"]);

            // Sideboard: one pane, only its non-empty columns.
            const side = paneOf(container, wrapper.sidePane);
            expect(columnLabelsIn(side)).toEqual(["Lands"]);

            // Split + the two independent zoom sliders.
            expect(
                getByLabelText("Resize Maindeck and Sideboard")
            ).toBeTruthy();
            expect(getByLabelText("Maindeck card size")).toBeTruthy();
            expect(getByLabelText("Sideboard card size")).toBeTruthy();

            // Legality panel (its own live region) and the save bar.
            expect(container.querySelector('[role="status"]')).toBeTruthy();
            expect(container.querySelector("form")).toBeTruthy();
            expect(getByDisplayValue("Test Deck")).toBeTruthy();
        });

        it("renaming the deck in the save bar takes effect", () => {
            const { getByDisplayValue } = wrapper.render();
            const nameInput = getByDisplayValue(
                "Test Deck"
            ) as HTMLInputElement;
            fireEvent.change(nameInput, { target: { value: "Renamed" } });
            expect(nameInput.value).toBe("Renamed");
        });

        it("clicking a Maindeck card takes it out of the Maindeck", () => {
            const { container, getByTitle } = wrapper.render();
            expect(cardsIn(container, "mv:1")).toEqual(["Lightning Bolt"]);
            fireEvent.click(getByTitle(/Remove Lightning Bolt/));
            expect(cardsIn(container, "mv:1")).toEqual([]);
        });

        it("dragging a Maindeck card onto the Sideboard moves it out of the Maindeck and into the Sideboard", async () => {
            const manager = new DragDropManager();
            const { container, getByTitle } = wrapper.render(manager);

            await dragOnto(
                manager,
                getByTitle(/Remove Lightning Bolt/),
                paneOf(container, wrapper.sidePane)
            );

            expect(cardsIn(container, "mv:1")).toEqual([]);
            expect(
                within(paneOf(container, wrapper.sidePane)).getByTitle(
                    /Remove Lightning Bolt/
                )
            ).toBeTruthy();
        });

        it("persists its split ratio under its OWN localStorage key, never the other builder's", () => {
            window.localStorage.setItem(wrapper.splitKey, "0.4");
            const { container } = wrapper.render();
            const split = container.querySelector(
                "[style*='--split-main']"
            ) as HTMLElement;
            expect(split.style.getPropertyValue("--split-main")).toBe("40%");

            cleanup();
            const otherKey =
                wrapper.splitKey === "tolaria:deckbuilderSplit:pool"
                    ? "tolaria:deckbuilderSplit:deckbuilder"
                    : "tolaria:deckbuilderSplit:pool";
            expect(window.localStorage.getItem(otherKey)).toBeNull();
        });
    }
);
