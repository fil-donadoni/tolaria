// Issue #2585 — the deckbuilder's filters as a SHEET (phone) / POPOVER (any
// roomier surface), plus the applied-filter tag row.
//
// Mounted on the REAL `DeckBuilder` for the reason `deck-builder-columns.test.tsx`
// gives: the tag row is a VIEW of the URL-backed filter set, so a test that
// hand-built a filter object and rendered `AppliedFilterTags` with it would
// assert on a fixture and never touch the wiring that actually breaks —
// `useFilterSearchParams` → `encodeFilters` → `decodeFilters` →
// `describeActiveFilters` → the writers in `deck-builder.tsx`. Here the router
// mock is STATEFUL, so every write really round-trips through the search-param
// codec, and the counts asserted come out of the real `useCardSearch`.
//
// Four module mocks, all of them plumbing: the router (stateful), Convex
// `useQuery` (a fixed card index), the surface-class seam (driven explicitly,
// because happy-dom evaluates no media query), and the dnd shims.
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { installDndJsdomShims } from "~/components/deckbuilder/__tests__/dragHarness";
import type { SurfaceClass } from "~/hooks/useSurfaceClass";

const h = vi.hoisted(() => ({
    search: {} as Record<string, unknown>,
    listeners: new Set<() => void>(),
    resolveQuery: (() => undefined) as (ref: unknown) => unknown,
    surface: "roomy-fine" as SurfaceClass,
}));

// A REAL search-param store: `useSearch` subscribes to it and `useNavigate`
// writes through `buildSearch`, so `encodeFilters`/`decodeFilters` are exercised
// on every filter change exactly as they are in the app.
vi.mock("@tanstack/react-router", () => ({
    useSearch: () =>
        useSyncExternalStore(
            (cb: () => void) => {
                h.listeners.add(cb);
                return () => h.listeners.delete(cb);
            },
            () => h.search
        ),
    useNavigate:
        () =>
        (opts: { search: (prev: unknown) => Record<string, unknown> }) => {
            const next = opts.search(h.search);
            // TanStack shares search refs across an unchanged navigation (see
            // `useFilterSearchParams`'s own comment) — a mock that handed back
            // a fresh object every time would re-run the debounce effect on
            // every render and spin. Structural equality, same as the router.
            if (JSON.stringify(next) === JSON.stringify(h.search)) return;
            h.search = next;
            for (const cb of [...h.listeners]) cb();
        },
}));

vi.mock("convex/react", () => ({
    useQuery: (ref: unknown) => h.resolveQuery(ref),
}));

vi.mock("~/hooks/useSurfaceClass", () => ({
    useSurfaceClass: () => h.surface,
}));

import { getFunctionName } from "convex/server";
import DeckBuilder from "../deck-builder";
import type { CardIndexEntry } from "../useCardSearch";
import type { LobbyDeck } from "~/lib/deckTypes";

function entry(
    name: string,
    colors: string[],
    types: string[],
    manaValue: number
): CardIndexEntry {
    return {
        cardId: `id-${name}`,
        name,
        nameLower: name.toLowerCase(),
        nameFold: name.toLowerCase(),
        types,
        subtypes: [],
        supertypes: [],
        colors,
        manaValue,
        oracleText: "",
        oracleFold: "",
        prints: [{ printId: `print-${name}`, setCode: "lea" }],
        available: true,
    };
}

// Two white creatures, one blue instant — so "White" and "Creature" pick out
// different, overlapping subsets and a removal is observable in the count.
const INDEX: CardIndexEntry[] = [
    entry("Serra Angel", ["W"], ["Creature"], 5),
    entry("Savannah Lions", ["W"], ["Creature"], 1),
    entry("Counterspell", ["U"], ["Instant"], 2),
    entry("Wrath of God", ["W"], ["Sorcery"], 4),
];

const BOLT = {
    cardId: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
    cardName: "Lightning Bolt",
};

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

function deck(): LobbyDeck {
    return {
        id: "deck-1",
        name: "Test Deck",
        format: "freeform",
        colors: [],
        cards: [BOLT],
        sideboard: [],
    } as unknown as LobbyDeck;
}

function renderBuilder() {
    return render(
        <DeckBuilder
            kind="user"
            initialDeck={deck()}
            initialIdentity="deck-1"
            initialDeckList={[]}
            sinks={sinks as never}
            onClose={() => {}}
        />
    );
}

/** CREATE mode. The deck's Format is immutable once it exists (ADR 0036), so
 *  the cube's own Format LOCK — the thing clearing a cube has to release — is
 *  only observable on a deck that does not exist yet. */
function renderNewBuilder() {
    return render(
        <DeckBuilder
            kind="user"
            mode="create"
            initialDeck={null}
            initialIdentity={null}
            initialDeckList={[]}
            sinks={sinks as never}
            onClose={() => {}}
        />
    );
}

beforeAll(installDndJsdomShims);
beforeEach(() => {
    window.localStorage.clear();
    h.search = {};
    h.listeners.clear();
    h.surface = "roomy-fine";
    // Convex's generated `api` is a PROXY — `api.cardIndex.list` is a fresh
    // object on every access, so identity comparison silently never matches and
    // every query reads as loading. Compare the resolved function NAME instead.
    h.resolveQuery = (ref: unknown) => {
        try {
            return getFunctionName(ref as never) === "cardIndex:list"
                ? INDEX
                : undefined;
        } catch {
            return undefined;
        }
    };
    vi.clearAllMocks();
});

/** The Filters trigger, whichever shape the surface class gives it. */
function filtersTrigger(container: HTMLElement): HTMLElement {
    return within(container).getByRole("button", { name: /^Filters/ });
}

function tagRow(container: HTMLElement): HTMLElement | null {
    return container.querySelector("[data-applied-filters]");
}

describe("the filter band is GONE from the header (#2585)", () => {
    for (const surface of ["phone", "roomy-coarse", "roomy-fine"] as const) {
        it(`renders no filter control inline on ${surface} — only the Filters button`, () => {
            h.surface = surface;
            const { container } = renderBuilder();
            // The colour chips are the tallest thing the old band carried.
            expect(
                container.querySelector('[aria-label="Color W"]')
            ).toBeNull();
            expect(
                document.body.querySelector('[aria-label="Color W"]')
            ).toBeNull();
            expect(filtersTrigger(container)).toBeTruthy();
        });
    }
});

describe("sheet on a phone, popover elsewhere (#2585)", () => {
    it("phone: the trigger opens a bottom SHEET with a live result-count CTA", () => {
        h.surface = "phone";
        const { container } = renderBuilder();
        expect(document.body.querySelector("[data-filters-sheet]")).toBeNull();

        fireEvent.click(filtersTrigger(container));
        const sheet = document.body.querySelector(
            "[data-filters-sheet]"
        ) as HTMLElement;
        expect(sheet).toBeTruthy();
        // IDLE (no filter). The real `useCardSearch` returns `entries: []`
        // there and `ResultsGrid` renders "Search or pick a filter to see
        // cards" — so the CTA must NOT promise a count. Review finding 2: the
        // first version of this test asserted "Show 0 cards", pinning the
        // defect as correct behaviour.
        expect(
            within(sheet).queryByRole("button", { name: /^Show \d+ cards?$/ })
        ).toBeNull();
        expect(
            within(sheet).getByRole("button", {
                name: /^Pick a filter to see cards$/,
            })
        ).toBeTruthy();

        // Pick White INSIDE the sheet — three white cards in the index.
        fireEvent.click(within(sheet).getByLabelText("Color W"));
        expect(
            within(sheet).getByRole("button", { name: /^Show 3 cards$/ })
        ).toBeTruthy();

        // Closing is the CTA; it applies nothing because nothing was staged.
        fireEvent.click(
            within(sheet).getByRole("button", { name: /^Show 3 cards$/ })
        );
        expect(document.body.querySelector("[data-filters-sheet]")).toBeNull();
        expect(tagRow(container)!.textContent).toContain("White");
    });

    for (const surface of ["roomy-coarse", "roomy-fine"] as const) {
        it(`${surface}: the trigger opens an anchored POPOVER, never a sheet`, () => {
            h.surface = surface;
            const { container } = renderBuilder();
            fireEvent.click(filtersTrigger(container));
            expect(
                document.body.querySelector("[data-filters-sheet]")
            ).toBeNull();
            const popover = document.body.querySelector(
                "[data-filters-popover]"
            ) as HTMLElement;
            expect(popover).toBeTruthy();
            expect(within(popover).getByLabelText("Color W")).toBeTruthy();
        });
    }
});

describe("the applied-filter tag row (#2585)", () => {
    for (const surface of ["phone", "roomy-coarse", "roomy-fine"] as const) {
        it(`reflects the active filters on ${surface}`, () => {
            h.surface = surface;
            const { container } = renderBuilder();
            expect(tagRow(container)).toBeNull();

            fireEvent.click(filtersTrigger(container));
            const panel = document.body.querySelector(
                "[data-filters-sheet], [data-filters-popover]"
            ) as HTMLElement;
            fireEvent.click(within(panel).getByLabelText("Color W"));
            fireEvent.click(within(panel).getByLabelText("Color U"));

            const row = tagRow(container)!;
            expect(row.textContent).toContain("White");
            expect(row.textContent).toContain("Blue");
            // The button badges the same count the row shows.
            expect(
                filtersTrigger(container).querySelector("[data-filter-count]")!
                    .textContent
            ).toBe("2");
        });
    }

    it("× removes exactly one filter and the search follows", () => {
        h.surface = "phone";
        const { container } = renderBuilder();
        fireEvent.click(filtersTrigger(container));
        let sheet = document.body.querySelector(
            "[data-filters-sheet]"
        ) as HTMLElement;
        fireEvent.click(within(sheet).getByLabelText("Color W"));
        fireEvent.click(within(sheet).getByLabelText("Color U"));
        // W or U (default `include-any`) = every card in the index.
        expect(
            within(sheet).getByRole("button", { name: /^Show 4 cards$/ })
        ).toBeTruthy();

        const row = tagRow(container)!;
        fireEvent.click(within(row).getByLabelText("Remove colour Blue"));

        expect(tagRow(container)!.textContent).toContain("White");
        expect(tagRow(container)!.textContent).not.toContain("Blue");
        sheet = document.body.querySelector(
            "[data-filters-sheet]"
        ) as HTMLElement;
        expect(
            within(sheet).getByRole("button", { name: /^Show 3 cards$/ })
        ).toBeTruthy();
    });

    // The two removals the container used to hand-branch (review finding 3).
    // Both were uncovered: no case in this file removed a text or a cube chip,
    // so `handleRemoveTag`'s branches could be no-opped with the whole
    // deckbuilder suite staying green.

    it("× on the TEXT chip clears the search BOX too, so the query does not come straight back", () => {
        // Seeded through the search params, so `rawText` and `filters.text`
        // start in step exactly as they do on a shared/reloaded URL.
        h.search = { q: "Serra" };
        h.surface = "roomy-fine";
        const { container } = renderBuilder();

        const box = within(container).getByPlaceholderText(
            /^Search cards by name/
        ) as HTMLInputElement;
        expect(box.value).toBe("Serra");
        expect(tagRow(container)!.textContent).toContain("Serra");

        fireEvent.click(
            within(tagRow(container)!).getByLabelText(
                "Remove text search Serra"
            )
        );

        // Both halves, and the second is the load-bearing one: the box keeps an
        // un-debounced copy of the query, and the debounce effect re-applies it
        // on the next render. Clear `filters.text` alone and the chip returns
        // while the box still shows a query the user thought they removed.
        expect(
            (
                within(container).getByPlaceholderText(
                    /^Search cards by name/
                ) as HTMLInputElement
            ).value
        ).toBe("");
        expect(tagRow(container)).toBeNull();
    });

    it("× on the CUBE chip clears the cube and releases the Format lock", () => {
        h.search = { cube: "vintage-cube" };
        h.surface = "roomy-coarse";
        const { container } = renderNewBuilder();

        const row = tagRow(container)!;
        expect(row.textContent).toContain("Vintage Cube");
        // Cube and Format are mutually exclusive scopes: while a cube is
        // selected the Format select is replaced by a locked label.
        expect(within(container).queryByLabelText("Deck format")).toBeNull();
        expect(
            within(container).getByText("Freeform").getAttribute("title")
        ).toMatch(/forced to Freeform while a cube is selected/);

        fireEvent.click(within(row).getByLabelText("Remove cube Vintage Cube"));

        expect(tagRow(container)).toBeNull();
        expect(
            filtersTrigger(container).querySelector("[data-filter-count]")
        ).toBeNull();
        // The control is back — the chip's × really went through the writer
        // that owns the cube/Format exclusion, not just through the chip.
        expect(within(container).getByLabelText("Deck format")).toBeTruthy();
    });

    it("Clear all empties the row and returns the search to idle", () => {
        h.surface = "roomy-fine";
        const { container } = renderBuilder();
        fireEvent.click(filtersTrigger(container));
        const popover = document.body.querySelector(
            "[data-filters-popover]"
        ) as HTMLElement;
        fireEvent.click(within(popover).getByLabelText("Color W"));
        fireEvent.click(within(popover).getByLabelText("Colorless"));

        const row = tagRow(container)!;
        expect(row.textContent).toContain("White");
        expect(row.textContent).toContain("Colorless");

        fireEvent.click(within(row).getByRole("button", { name: "Clear all" }));
        expect(tagRow(container)).toBeNull();
        expect(
            filtersTrigger(container).querySelector("[data-filter-count]")
        ).toBeNull();
    });
});
