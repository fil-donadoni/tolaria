// The deck builder's visual printing picker (issue #4122): the `cardPrints`
// query runs only once the picker opens, the Set text filter ("odyssey")
// restricts the QUERY to the matching Set codes, the Format's allowed Sets
// (Old School / Alpha 40) are never widened by it, and one click picks.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import PrintingPicker from "../printing-picker";

interface Row {
    printId: string;
    set: string;
    promo: boolean;
    digital: boolean;
}

const ROWS: Row[] = [
    { printId: "ody-1", set: "ody", promo: false, digital: false },
    { printId: "ody-2", set: "ody", promo: false, digital: false },
    { printId: "leb-1", set: "leb", promo: false, digital: false },
    { printId: "plst-1", set: "plst", promo: true, digital: false },
    { printId: "arena-1", set: "ana", promo: false, digital: true },
];

const queryArgs = vi.hoisted(() => [] as unknown[]);

vi.mock("convex/react", () => ({
    usePaginatedQuery: (
        _query: unknown,
        args: "skip" | { allowedSets?: string[] }
    ) => {
        queryArgs.push(args);
        if (args === "skip")
            return {
                results: [],
                status: "LoadingFirstPage",
                loadMore: () => {},
            };
        const sets = args.allowedSets;
        const page = ROWS.filter((r) => !sets || sets.includes(r.set)).map(
            (r) => ({
                ...r,
                cardId: "forest",
                rarity: "common",
                tokenPrints: [],
            })
        );
        return { results: page, status: "Exhausted", loadMore: () => {} };
    },
}));

vi.mock("~/components/cards/card-image", () => ({
    default: ({ card }: { card: { id: string } }) => (
        <div data-testid="card-image" data-print-id={card.id} />
    ),
}));

function lastArgs() {
    return queryArgs[queryArgs.length - 1];
}

function tileIds() {
    return [
        ...document.querySelectorAll<HTMLElement>("button[data-print-id]"),
    ].map((b) => b.dataset.printId);
}

beforeEach(() => {
    queryArgs.length = 0;
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
            ok: true,
            json: async () => ({
                data: [
                    { code: "ody", name: "Odyssey" },
                    { code: "leb", name: "Limited Edition Beta" },
                    { code: "plst", name: "The List" },
                    { code: "ana", name: "Arena New Player Experience" },
                ],
            }),
        }))
    );
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function renderPicker(
    allowedSets: string[] | null,
    onSelect = vi.fn()
): ReturnType<typeof vi.fn> {
    render(
        <PrintingPicker
            cardName="Forest"
            cardId="forest"
            basePrintings={[{ printId: "forest", setCode: "lea" }]}
            allowedSets={allowedSets}
            selected={{ printId: "forest", setCode: "lea" }}
            onSelect={onSelect}
        />
    );
    return onSelect;
}

describe("PrintingPicker", () => {
    it("never reads cardPrints until it opens", () => {
        renderPicker(null);
        expect(queryArgs.length).toBeGreaterThan(0);
        expect(queryArgs.every((a) => a === "skip")).toBe(true);
        fireEvent.click(screen.getByLabelText("Choose printing of Forest"));
        expect(lastArgs()).toEqual({
            cardId: "forest",
            allowedSets: undefined,
        });
        // The Definition's own printing (never in the table) leads the grid.
        expect(tileIds()).toEqual([
            "forest",
            "ody-1",
            "ody-2",
            "leb-1",
            "plst-1",
            "arena-1",
        ]);
    });

    it("restricts the query to the Sets a typed Set name matches", async () => {
        renderPicker(null);
        fireEvent.click(screen.getByLabelText("Choose printing of Forest"));
        fireEvent.change(screen.getByPlaceholderText("Set name or code…"), {
            target: { value: "odyssey" },
        });
        await waitFor(() =>
            expect(lastArgs()).toEqual({
                cardId: "forest",
                allowedSets: ["ody"],
            })
        );
        expect(tileIds()).toEqual(["ody-1", "ody-2"]);
    });

    it("never widens the Format's allowed Sets", async () => {
        renderPicker(["lea", "leb"]);
        fireEvent.click(screen.getByLabelText("Choose printing of Forest"));
        expect(lastArgs()).toEqual({
            cardId: "forest",
            allowedSets: ["lea", "leb"],
        });
        expect(tileIds()).toEqual(["forest", "leb-1"]);
        fireEvent.change(screen.getByPlaceholderText("Set name or code…"), {
            target: { value: "odyssey" },
        });
        await waitFor(() => expect(tileIds()).toEqual([]));
        expect(lastArgs()).toBe("skip");
        expect(screen.getByText("No printing matches.")).toBeDefined();
    });

    it("filters by kind and picks a printing with one click", async () => {
        const onSelect = renderPicker(null);
        fireEvent.click(screen.getByLabelText("Choose printing of Forest"));
        fireEvent.click(screen.getByRole("button", { name: /^Promo/ }));
        expect(tileIds()).toEqual(["plst-1"]);
        fireEvent.click(screen.getByRole("button", { name: /^Digital/ }));
        expect(tileIds()).toEqual(["arena-1"]);
        fireEvent.click(
            await screen.findByLabelText(
                "Arena New Player Experience (ANA), digital"
            )
        );
        expect(onSelect).toHaveBeenCalledWith(
            expect.objectContaining({ printId: "arena-1", setCode: "ana" })
        );
        expect(tileIds()).toEqual([]);
    });
});
