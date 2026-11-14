// The preferred printing per card (issue #8755). The grid reads every saved
// preference from ONE subscription and hands each cell its card's — so a pick
// survives the cell unmounting (windowed scroll), a new search and a reload
// (the server row), for a Search Index and a Full Catalogue entry alike.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { CardIndexEntry } from "../useCardSearch";
import ResultsGrid from "../results-grid";

type Pref = { cardKey: string; printId: string; setCode: string };

const state = vi.hoisted(() => ({
    prefs: [] as Pref[],
    save: vi.fn(),
    listCalls: 0,
}));

vi.mock("convex/react", () => ({
    useQuery: (ref: unknown) => {
        if (getFunctionName(ref as never) !== "userCardPrints:listMyCardPrints")
            return undefined;
        state.listCalls++;
        return state.prefs;
    },
    useMutation: () => state.save,
    usePaginatedQuery: () => ({
        results: [],
        status: "LoadingFirstPage",
        loadMore: () => {},
    }),
}));

vi.mock("~/components/cards/card-image", () => ({
    default: ({ card }: { card: { id: string } }) => (
        <div data-testid="card-image" data-print-id={card.id} />
    ),
}));
vi.mock("../draggable-card", () => ({
    default: ({
        children,
        onClick,
        title,
    }: {
        children: React.ReactNode;
        onClick: () => void;
        title: string;
    }) => (
        <button data-testid="draggable" title={title} onClick={onClick}>
            {children}
        </button>
    ),
}));

function indexEntry(): CardIndexEntry {
    return {
        cardId: "sliver-queen",
        name: "Sliver Queen",
        nameLower: "sliver queen",
        nameFold: "sliver queen",
        types: ["Creature"],
        subtypes: ["Sliver"],
        supertypes: ["Legendary"],
        colors: ["W", "U", "B", "R", "G"],
        manaValue: 7,
        oracleText: "All Sliver creatures have this ability.",
        oracleFold: "all sliver creatures have this ability.",
        prints: [
            { printId: "sq-sth", setCode: "sth" },
            { printId: "sq-plst", setCode: "plst" },
        ],
        available: true,
    };
}

// A Full Catalogue entry: its `cardId` is a PRINT id, so only the folded
// name can key its preference.
function catalogueEntry(): CardIndexEntry {
    return {
        cardId: "efreet-print-1",
        name: "Ifh-Bíff Efreet",
        nameLower: "ifh-bíff efreet",
        nameFold: "ifh-biff efreet",
        types: ["Creature"],
        subtypes: ["Efreet"],
        supertypes: [],
        colors: ["G"],
        manaValue: 4,
        oracleText: "",
        oracleFold: "",
        prints: [{ printId: "efreet-print-1", setCode: "arn" }],
        available: false,
    };
}

function grid(entries: CardIndexEntry[], onAdd = vi.fn()) {
    return (
        <ResultsGrid
            entries={entries}
            idle={false}
            activeSets={[]}
            allowedSets={null}
            enforceAvailability={false}
            onAdd={onAdd}
        />
    );
}

function imageOf(cell: HTMLElement): string | undefined {
    return cell.querySelector<HTMLElement>("[data-testid=card-image]")?.dataset
        .printId;
}

beforeEach(() => {
    state.prefs = [];
    state.listCalls = 0;
    state.save = vi.fn(() => Promise.resolve(null));
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
});
afterEach(() => vi.unstubAllGlobals());

describe("ResultsGrid preferred printing (issue #8755)", () => {
    it("shows and adds a saved preference, for an index and a catalogue entry", () => {
        state.prefs = [
            { cardKey: "sliver queen", printId: "sq-plst", setCode: "plst" },
            {
                cardKey: "ifh-biff efreet",
                printId: "efreet-print-9",
                setCode: "me4",
            },
        ];
        const onAdd = vi.fn();
        const { getAllByTestId } = render(
            grid([indexEntry(), catalogueEntry()], onAdd)
        );
        const [queen, efreet] = getAllByTestId("draggable");
        expect(imageOf(queen)).toBe("sq-plst");
        expect(imageOf(efreet)).toBe("efreet-print-9");
        fireEvent.click(queen);
        fireEvent.click(efreet);
        expect(onAdd).toHaveBeenNthCalledWith(
            1,
            "sq-plst",
            "Sliver Queen",
            "sliver-queen"
        );
        expect(onAdd).toHaveBeenNthCalledWith(
            2,
            "efreet-print-9",
            "Ifh-Bíff Efreet",
            undefined
        );
    });

    it("reads every cell's preference from one subscription", () => {
        // A per-cell query would scale with the mounted cells; one grid
        // subscription reads the same whatever their number.
        const one = render(grid([indexEntry()]));
        const withOne = state.listCalls;
        one.unmount();
        state.listCalls = 0;
        const many = Array.from({ length: 6 }, (_, i) => ({
            ...indexEntry(),
            cardId: `card-${i}`,
            name: `Card ${i}`,
        }));
        render(grid(many));
        expect(withOne).toBeGreaterThan(0);
        expect(state.listCalls).toBe(withOne);
    });

    it("saves a pick, shows it at once, and keeps it across a new search", () => {
        // A failed save must not undo the visible choice for the session.
        state.save = vi.fn(() => Promise.reject(new Error("offline")));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { getByLabelText, getAllByRole, getByTestId, rerender } = render(
            grid([indexEntry()])
        );
        fireEvent.click(getByLabelText("Choose printing of Sliver Queen"));
        const tile = getAllByRole("button").find(
            (b) => b.dataset.printId === "sq-plst"
        );
        fireEvent.click(tile!);
        expect(state.save).toHaveBeenCalledWith({
            cardName: "Sliver Queen",
            printId: "sq-plst",
            setCode: "plst",
        });
        expect(imageOf(getByTestId("draggable"))).toBe("sq-plst");

        // A new search unmounts the cell; coming back remounts it.
        rerender(grid([catalogueEntry()]));
        rerender(grid([indexEntry()]));
        expect(imageOf(getByTestId("draggable"))).toBe("sq-plst");
        warn.mockRestore();
    });
});
