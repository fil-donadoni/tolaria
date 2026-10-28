// The basic-land tile's art (issue #1629, ADR 0075 § "Basic-land art"; the
// issue #4122 printing picker since issue #5398):
// Format-filtered grid, retroactive rewrite of the OPEN deck's copies, and
// silent fallback for a stale/illegal stored preference. Mounted on the REAL
// `DeckBuilder` (Constructed) — the grid's set filter and the rewrite both
// depend on wiring (`FORMAT_RULES[deck.format].allowedSets`, the save sink's
// payload) a hand-built `PoolBasicLandsBar` render would mask.
import {
    describe,
    it,
    expect,
    vi,
    beforeAll,
    beforeEach,
    afterEach,
} from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { saveBasicLandPrintId } from "~/lib/deckViewPrefs";
import type { LobbyDeck } from "~/lib/deckTypes";
import type { StoredDeckColumnLayout } from "@convex/deckLayout";
import { MOUNTAIN_PRINT_ROWS } from "~/components/deckbuilder/__tests__/basicLandPrintRows";
import DeckBuilder from "../deck-builder";

vi.mock("~/lib/useEarliestPrintFetcher", () => ({
    useEarliestPrintFetcher: () => async () => new Map(),
}));
vi.mock("~/lib/useCardPrintings", async () => ({
    useCardPrintings: (
        await import("~/components/deckbuilder/__tests__/basicLandPrintRows")
    ).useCardPrintingsStub,
}));
vi.mock("~/lib/useScryfallSetNames", async () => ({
    useScryfallSetNames: (
        await import("~/components/deckbuilder/__tests__/basicLandPrintRows")
    ).useScryfallSetNamesStub,
}));
vi.mock("~/lib/useBasicLandPreferenceRows", async () => ({
    useBasicLandPreferenceRows: (
        await import("~/components/deckbuilder/__tests__/basicLandPrintRows")
    ).useBasicLandPreferenceRowsStub,
}));

// The search index is a generated asset fetched by its own module (issue
// #4861); stubbed as never loaded so no test reaches the network (issue #3422).
vi.mock("~/lib/searchIndex", () => ({
    useSearchIndex: () => ({ rows: undefined, error: null }),
}));
vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => vi.fn(),
    useSearch: () => ({}),
}));

vi.mock("convex/react", () => ({ useQuery: () => undefined }));

// Real registry ids (mirrors `basicLands.test.ts` / `deck-builder-columns.test.tsx`).
const BOLT = {
    cardId: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
    cardName: "Lightning Bolt",
};
const MOUNTAIN_ID = "eace2c85-976c-425e-9800-5a6ccbd91b56"; // catalogue-canonical (LEA)
const LEB_MOUNTAIN_PRINT = "7af9c715-8d72-4eae-b412-fc89138ff588"; // leb
const ICE_MOUNTAIN_PRINT = "4ecf39c3-3b5f-4263-a7b5-9881bded3494"; // ice
const MOUNTAIN = { cardId: MOUNTAIN_ID, cardName: "Mountain" };
const LEB_MOUNTAIN = { cardId: LEB_MOUNTAIN_PRINT, cardName: "Mountain" };

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
    format: LobbyDeck["format"],
    cards: { cardId: string; cardName: string }[],
    sideboard: { cardId: string; cardName: string }[] = [],
    layout?: StoredDeckColumnLayout
): LobbyDeck {
    return {
        id: "deck-1",
        name: "Test Deck",
        format,
        colors: [],
        cards,
        sideboard,
        layout,
    } as unknown as LobbyDeck;
}

/** The printing picker's tiles (a dialog portal, so queried off `document`). */
function pickerTiles(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>("button[data-print-id]")];
}

/** The stub's 4ED Mountain tiles. */
function fourthEditionTiles(): HTMLElement[] {
    const ids = new Set(
        MOUNTAIN_PRINT_ROWS.filter((r) => r.set === "4ed").map((r) => r.printId)
    );
    return pickerTiles().filter((t) => ids.has(t.dataset.printId!));
}

function renderBuilder(initialDeck: LobbyDeck) {
    return render(
        <DeckBuilder
            kind="user"
            initialDeck={initialDeck}
            initialIdentity="deck-1"
            initialDeckList={[]}
            sinks={sinks as never}
            onClose={() => {}}
        />
    );
}

// happy-dom's default window is 1024x768 (landscape) — coincidentally the
// exact shape `deck-source-dock:` targets (issue #2585 review finding #3:
// `useDeckSourceDock` mirrors that CSS variant's media query in JS, and
// 1024x768 satisfies its `min-width: 1024px` / `min-height: 501px` /
// landscape clauses). Unstubbed, every render here would fold the ADD BASIC
// bar behind its dock trigger, and every `getByLabelText("Add one Mountain")` below
// would miss. `dragHarness.ts`'s `installDndJsdomShims` already stubs
// `matchMedia` to always report no match for the sibling drag-mounted
// `DeckBuilder` harness (`deck-builder-zones.test.tsx`) — same fix, applied
// here without the rest of that harness's drag-only shims (IntersectionObserver,
// `getAnimations`), which this file never exercises.
beforeAll(() => {
    (window as unknown as { matchMedia: (q: string) => unknown }).matchMedia =
        () => ({
            matches: false,
            addEventListener() {},
            removeEventListener() {},
        });
});

beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
});

afterEach(() => {
    cleanup();
    window.localStorage.clear();
});

describe("Basic-land tile art grid — filtered to the deck's Format (issue #1629 AC3)", () => {
    it("offers only the printings the Format's allowedSets allows (Alpha 40: lea + leb, 2+3 = 5)", () => {
        const rendered = renderBuilder(deck("alpha-40", [MOUNTAIN]));
        fireEvent.click(rendered.getByLabelText("Choose Mountain art"));

        const allowed = new Set([
            MOUNTAIN_ID,
            ...MOUNTAIN_PRINT_ROWS.filter(
                (r) => r.set === "lea" || r.set === "leb"
            ).map((r) => r.printId),
        ]);
        const offered = pickerTiles().map((t) => t.dataset.printId!);
        expect(offered).toHaveLength(5);
        for (const id of offered) expect(allowed.has(id)).toBe(true);
        // Every other printed set is absent from the grid.
        expect(offered).not.toContain(ICE_MOUNTAIN_PRINT);
        expect(fourthEditionTiles()).toHaveLength(0);
    });

    it("offers every printing when the Format has no set restriction (Freeform: allowedSets null)", () => {
        const rendered = renderBuilder(deck("freeform", [MOUNTAIN]));
        fireEvent.click(rendered.getByLabelText("Choose Mountain art"));
        expect(pickerTiles()).toHaveLength(15);
    });
});

describe("Basic-land tile art — retroactive rewrite of the OPEN deck (issue #1629 AC5/AC9)", () => {
    it("rewrites every copy of the subtype in BOTH Maindeck and Sideboard, leaving other cards and deck size untouched", async () => {
        const rendered = renderBuilder(
            deck("freeform", [MOUNTAIN, BOLT], [LEB_MOUNTAIN])
        );
        fireEvent.click(rendered.getByLabelText("Choose Mountain art"));
        const target = fourthEditionTiles()[0];
        const chosenPrintId = target.getAttribute("data-print-id")!;
        fireEvent.click(target);

        rendered.unmount();
        await waitFor(() => expect(sinks.user.update).toHaveBeenCalled());
        const [, payload] = sinks.user.update.mock.calls.at(-1)!;

        expect(payload.cards).toEqual([
            { cardId: chosenPrintId, cardName: "Mountain" },
            BOLT,
        ]);
        expect(payload.sideboard).toEqual([
            { cardId: chosenPrintId, cardName: "Mountain" },
        ]);
        // Deck size (both zones) is exactly what it was before the rewrite.
        expect(payload.cards).toHaveLength(2);
        expect(payload.sideboard).toHaveLength(1);
    });

    it("picking a printing closes the picker (one click picks)", () => {
        const rendered = renderBuilder(deck("freeform", [MOUNTAIN]));
        fireEvent.click(rendered.getByLabelText("Choose Mountain art"));
        expect(pickerTiles().length).toBeGreaterThan(0);
        fireEvent.click(fourthEditionTiles()[0]);
        expect(pickerTiles()).toHaveLength(0);
    });
});

// G1 (review of PR #2325 fixup, round 2): the F1 remap primitives
// (`basicLandArtCardIdsToRemap`, `remapPinKeys`) are proven in isolation
// elsewhere (`basicLands.test.ts`, `deckLayout.test.ts`) and hand-composed in
// a unit test that mirrors `handlePickBasicArt`'s own order — which proves
// the composition against a copy of itself, not against the call site. These
// tests mount the REAL `DeckBuilder` (this file's own harness), pin a
// Mountain to a manual Column, pick a different printing from the art grid,
// and assert on the REAL save-sink payload — the only path that actually
// exercises `handlePickBasicArt`'s wiring. Deleting the `remapPinKeys` block
// from the handler (restoring the exact F1 bug) turns these red; every other
// test in this file and in `basicLands.test.ts`/`deckLayout.test.ts` stays
// green under that same mutation.
describe("Card Pin re-key wiring — full path through the real DeckBuilder (issue #1629 fixup, finding G1)", () => {
    const LANDS_COLUMN = "custom:lands";

    it("a Maindeck Pin survives an art pick, re-keyed onto the chosen printing, no orphan left", async () => {
        const rendered = renderBuilder(
            deck("freeform", [MOUNTAIN, BOLT], [], {
                maindeck: {
                    manualColumns: [{ id: LANDS_COLUMN, label: "Lands" }],
                    pins: { [MOUNTAIN_ID]: { custom: LANDS_COLUMN } },
                },
            })
        );
        fireEvent.click(rendered.getByLabelText("Choose Mountain art"));
        const target = fourthEditionTiles()[0];
        const chosenPrintId = target.getAttribute("data-print-id")!;
        fireEvent.click(target);

        rendered.unmount();
        await waitFor(() => expect(sinks.user.update).toHaveBeenCalled());
        const [, payload] = sinks.user.update.mock.calls.at(-1)!;

        expect(payload.layout.maindeck.pins).toEqual({
            [chosenPrintId]: { custom: LANDS_COLUMN },
        });
        expect(payload.layout.maindeck.pins[MOUNTAIN_ID]).toBeUndefined();
    });

    it("a Sideboard Pin survives an art pick the same way", async () => {
        const rendered = renderBuilder(
            deck("freeform", [BOLT], [MOUNTAIN], {
                sideboard: {
                    manualColumns: [{ id: LANDS_COLUMN, label: "Lands" }],
                    pins: { [MOUNTAIN_ID]: { custom: LANDS_COLUMN } },
                },
            })
        );
        fireEvent.click(rendered.getByLabelText("Choose Mountain art"));
        const target = fourthEditionTiles()[0];
        const chosenPrintId = target.getAttribute("data-print-id")!;
        fireEvent.click(target);

        rendered.unmount();
        await waitFor(() => expect(sinks.user.update).toHaveBeenCalled());
        const [, payload] = sinks.user.update.mock.calls.at(-1)!;

        expect(payload.layout.sideboard.pins).toEqual({
            [chosenPrintId]: { custom: LANDS_COLUMN },
        });
        expect(payload.layout.sideboard.pins[MOUNTAIN_ID]).toBeUndefined();
    });

    it("an art pick on a deck with no arrangement at all does NOT materialise an empty layout (note N3)", async () => {
        const rendered = renderBuilder(deck("freeform", [MOUNTAIN]));
        fireEvent.click(rendered.getByLabelText("Choose Mountain art"));
        fireEvent.click(fourthEditionTiles()[0]);

        rendered.unmount();
        await waitFor(() => expect(sinks.user.update).toHaveBeenCalled());
        const [, payload] = sinks.user.update.mock.calls.at(-1)!;

        expect(payload.layout).toBeUndefined();
    });
});

describe("Basic-land tile art — a stale or illegal stored preference falls back silently (issue #1629 AC8)", () => {
    it("a preference for a printing that no longer exists falls back to the catalogue default", () => {
        saveBasicLandPrintId("Mountain", "not-a-real-printing-anymore");
        const rendered = renderBuilder(deck("freeform", []));
        fireEvent.click(rendered.getByLabelText("Add one Mountain"));
        expect(sinks.user.update).not.toHaveBeenCalled(); // nothing async yet
        // The trigger renders (a resolved id exists) — the pathological
        // "no definition at all" case is the only one that disables it.
        expect(
            (
                rendered.getByLabelText(
                    "Choose Mountain art"
                ) as HTMLButtonElement
            ).disabled
        ).toBe(false);
    });

    it("a preference illegal under the CURRENT Format (e.g. an ICE printing under Alpha 40) falls back — added copies use the base resolution, not the stale pick", async () => {
        saveBasicLandPrintId("Mountain", ICE_MOUNTAIN_PRINT);
        const rendered = renderBuilder(deck("alpha-40", []));
        fireEvent.click(rendered.getByLabelText("Add one Mountain"));

        rendered.unmount();
        await waitFor(() => expect(sinks.user.update).toHaveBeenCalled());
        const [, payload] = sinks.user.update.mock.calls.at(-1)!;
        // Never the illegal ICE preference.
        expect(payload.cards).not.toContainEqual(
            expect.objectContaining({ cardId: ICE_MOUNTAIN_PRINT })
        );
        // Alpha 40 has no Pool, so the base resolution is the catalogue
        // canonical (LEA) printing.
        expect(payload.cards).toEqual([
            { cardId: MOUNTAIN_ID, cardName: "Mountain" },
        ]);
    });
});
