// The Manual Game log's name resolution (issue #2350).
//
// The server has no name to interpolate for a manual card — `card: { id }`
// is the whole reference (ADR 0080's fourth invariant) — so `manual.ts`'s
// verbs embed `{{card:N}}` placeholders in `text` plus a positional `cards`
// array of print ids, and this component resolves each one through the Full
// Catalogue. These tests drive the REAL `ManualLog` component (not a
// hand-built entry renderer) so the reducer that actually ships is what's
// under test, per the issue's acceptance criteria.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import type { FullCatalogueRow } from "~/lib/fullCatalogue";

const BOLT_PRINT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const BEAR_PRINT = "b1623d57-4729-4796-b3f7-f1837a05c6ed";
const UNKNOWN_PRINT = "11111111-2222-3333-4444-555555555555";

function row(overrides: Partial<FullCatalogueRow> = {}): FullCatalogueRow {
    return {
        name: "Lightning Bolt",
        printId: BOLT_PRINT,
        typeLine: "Instant",
        manaCost: "{R}",
        cmc: 1,
        colourIdentity: "R",
        set: "lea",
        rarity: "common",
        nameFold: "lightning bolt",
        available: true,
        ...overrides,
    };
}

const CATALOGUE_ROWS: FullCatalogueRow[] = [
    row(),
    row({
        name: "Grizzly Bears",
        printId: BEAR_PRINT,
        typeLine: "Creature — Bear",
        manaCost: "{1}{G}",
        cmc: 2,
        colourIdentity: "G",
        nameFold: "grizzly bears",
    }),
];

let results: { action: unknown }[] = [];
vi.mock("convex/react", () => ({
    usePaginatedQuery: () => ({
        results,
        status: "Exhausted",
        loadMore: vi.fn(),
    }),
}));
vi.mock("@convex/_generated/api", () => ({
    api: { manualLog: { getManualLog: {} }, cardIndex: {} },
}));
vi.mock("~/lib/fullCatalogue", () => ({
    useFullCatalogue: () => ({ rows: CATALOGUE_ROWS, error: null }),
}));

const { default: ManualLog } = await import("../manual-log");

beforeEach(() => {
    cleanup();
    results = [];
});

describe("ManualLog card-name resolution (#2350)", () => {
    it("resolves a single {{card:0}} placeholder to the card's name", () => {
        results = [
            {
                action: {
                    text: "Alice moves {{card:0}} → graveyard",
                    cards: [BOLT_PRINT],
                },
            },
        ];
        render(<ManualLog gameId={"game-id" as never} />);
        expect(
            screen.getByText("Alice moves Lightning Bolt → graveyard")
        ).toBeTruthy();
        expect(screen.queryByText(/d573ef03/)).toBeNull();
    });

    it("resolves every placeholder in a multi-card entry (peek)", () => {
        results = [
            {
                action: {
                    text: "Alice looks at top 2 of library: {{card:0}}, {{card:1}}",
                    cards: [BOLT_PRINT, BEAR_PRINT],
                },
            },
        ];
        render(<ManualLog gameId={"game-id" as never} />);
        expect(
            screen.getByText(
                "Alice looks at top 2 of library: Lightning Bolt, Grizzly Bears"
            )
        ).toBeTruthy();
    });

    it("falls back to the raw print id when the catalogue can't resolve it — never blank, never a crash", () => {
        results = [
            {
                action: {
                    text: "Alice taps {{card:0}}",
                    cards: [UNKNOWN_PRINT],
                },
            },
        ];
        render(<ManualLog gameId={"game-id" as never} />);
        expect(screen.getByText(`Alice taps ${UNKNOWN_PRINT}`)).toBeTruthy();
    });

    it("renders a legacy entry (no `cards` field) verbatim — no backfill", () => {
        results = [
            { action: { text: "Filippo (P1) moves k7f3n2p9 → graveyard" } },
        ];
        render(<ManualLog gameId={"game-id" as never} />);
        expect(
            screen.getByText("Filippo (P1) moves k7f3n2p9 → graveyard")
        ).toBeTruthy();
    });
});

describe("ManualLog card-name resolution — edge cases (#2350)", () => {
    it("renders text verbatim when `cards` is an empty array (roll/shuffle-shaped entries)", () => {
        results = [
            {
                action: {
                    text: "Alice shuffles their library",
                    cards: [],
                },
            },
        ];
        render(<ManualLog gameId={"game-id" as never} />);
        expect(screen.getByText("Alice shuffles their library")).toBeTruthy();
    });

    it("substitutes multiple DIFFERENT cards in one entry (attach: subject + target)", () => {
        results = [
            {
                action: {
                    text: "Alice attaches {{card:0}} to {{card:1}}",
                    cards: [BOLT_PRINT, BEAR_PRINT],
                },
            },
        ];
        render(<ManualLog gameId={"game-id" as never} />);
        expect(
            screen.getByText("Alice attaches Lightning Bolt to Grizzly Bears")
        ).toBeTruthy();
    });

    it("leaves a placeholder with no matching `cards` entry untouched (defensive)", () => {
        results = [
            {
                action: {
                    text: "Alice taps {{card:3}}",
                    cards: [BOLT_PRINT],
                },
            },
        ];
        render(<ManualLog gameId={"game-id" as never} />);
        expect(screen.getByText("Alice taps {{card:3}}")).toBeTruthy();
    });
});
