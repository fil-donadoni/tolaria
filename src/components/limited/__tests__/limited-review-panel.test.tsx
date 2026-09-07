// Review panel tests (PRD #1107 story 26, issue #1116; admin-gated + compact
// redesign issue #1583; card piles issue #3167): drives `LimitedReviewPanel`
// through the `event` prop shape the WIRE-FORMAT query (`getLimitedEvent`)
// actually returns — `completed`/`pool`/`humanDeck`/`autoBuiltDeck`/
// `deckSummary` per the server projection — so a dropped field on the server
// side would surface here too (mirrors `limited-vs-ai-panel.test.tsx`'s
// discipline: never a hand-built GameState-shaped view). The server already
// strips another seat's pool/deck for a non-admin, so these tests fix the
// CLIENT half: a non-admin sees only the compact summary, an admin can expand
// the detail.
//
// Every card assertion below reads the REAL rendered pile DOM — the Column
// Layout engine's `[data-column]` elements and the tiles' own `title` — never
// a name list and never a hand-built view. That is what makes "the disclosure
// renders card images, grouped" an assertion about the surface issue #3167
// mounted rather than about a fixture.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedReviewPanel from "../limited-review-panel";

afterEach(() => {
    cleanup();
});

// Real registry ids — the Column Layout engine resolves each card through the
// card registry, so a made-up id would bucket everything into the Catch-All
// and no grouping assertion below would mean anything.
const BOLT = {
    cardId: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
    cardName: "Lightning Bolt",
}; // MV 1, red
const SERRA = {
    cardId: "f8ac5006-91bd-4803-93da-f87cf196dd2f",
    cardName: "Serra Angel",
}; // MV 5, white

/** Every card FACE rendered inside a Column, by the tile's own `title`. */
function tileTitles(root: ParentNode): string[] {
    return [...root.querySelectorAll("[data-column] [title]")].map(
        (el) => el.getAttribute("title") ?? ""
    );
}

/** One block's Column labels, in render order. */
function columnLabels(block: Element): string[] {
    return [...block.querySelectorAll("[data-column]")].map(
        (el) => el.querySelector("span")?.textContent ?? ""
    );
}

function blockOf(container: HTMLElement, slot: string): HTMLElement {
    const block = container.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
    expect(block, `no ${slot} block rendered`).toBeTruthy();
    return block!;
}

function makeEvent(
    overrides: Partial<LimitedEventView>,
    seatsOverride: Partial<LimitedEventView["seats"][number]>[]
): LimitedEventView {
    const base = {
        userId: undefined,
        nickname: undefined,
        isBot: false,
        isViewer: false,
        poolCount: null,
        pool: null,
        humanDeck: null,
        deckSummary: null,
        currentPack: null,
        packQueueCount: null,
        pickDeadline: null,
        autoBuiltDeck: null,
    };
    return {
        _id: "event-1",
        createdBy: "admin-1",
        type: "sealed",
        status: "started",
        seatCount: seatsOverride.length,
        packSlots: ["lea"],
        sealedBoosterCount: 6,
        completed: false,
        seatsWithDeck: 0,
        seats: seatsOverride.map((s, i) => ({
            ...base,
            seatIndex: i,
            ...s,
        })),
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    } as unknown as LimitedEventView;
}

describe("LimitedReviewPanel (issue #1116 / #1583)", () => {
    it("renders nothing while the event is not completed", () => {
        const event = makeEvent({ completed: false, seatsWithDeck: 1 }, [
            { seatIndex: 0, userId: "user-1", isViewer: true, pool: [] },
            { seatIndex: 1, isBot: true },
        ]);
        const { container } = render(
            <LimitedReviewPanel event={event} isAdmin={false} />
        );
        expect(container.firstChild).toBeNull();
    });

    it("shows every seat's compact summary (colors + counts) for a NON-admin, without any card list", () => {
        // A non-admin at a completed event: the server sent no other seat's
        // pool/humanDeck (both null here), only the ungated `deckSummary`.
        const event = makeEvent({ completed: true, seatsWithDeck: 2 }, [
            {
                seatIndex: 0,
                userId: "user-1",
                nickname: "Alice",
                isViewer: false,
                pool: null,
                humanDeck: null,
                deckSummary: {
                    colors: ["R"],
                    maindeckCount: 40,
                    sideboardCount: 3,
                },
            },
            {
                seatIndex: 1,
                isBot: true,
                nickname: "Bot 2",
                pool: null,
                // autoBuiltDeck stays on the wire (vs-AI hookup) — must NOT be
                // rendered as a deck for a non-admin.
                autoBuiltDeck: {
                    cards: [SERRA],
                    sideboard: [],
                    colors: ["R", "G"],
                },
                deckSummary: {
                    colors: ["R", "G"],
                    maindeckCount: 40,
                    sideboardCount: 5,
                },
            },
        ]);
        const { container } = render(
            <LimitedReviewPanel event={event} isAdmin={false} />
        );
        // Summaries render for every seat.
        expect(container.textContent).toContain("40 maindeck / 3 sideboard");
        expect(container.textContent).toContain("R/G");
        // No detail at all: no disclosure, no piles, no bot autoBuiltDeck.
        expect(container.querySelector("details")).toBeNull();
        expect(tileTitles(container)).toEqual([]);
    });

    it("lets a non-admin expand ONLY their own seat's detail", () => {
        const event = makeEvent({ completed: true, seatsWithDeck: 2 }, [
            {
                seatIndex: 0,
                userId: "user-1",
                nickname: "Alice",
                isViewer: true, // the viewer's own seat
                pool: [{ scryfallId: "s1", ...BOLT }],
                humanDeck: { cards: [BOLT], sideboard: [], colors: ["R"] },
                deckSummary: {
                    colors: ["R"],
                    maindeckCount: 1,
                    sideboardCount: 0,
                },
            },
            {
                seatIndex: 1,
                userId: "user-2",
                nickname: "Bob",
                isViewer: false,
                pool: null,
                humanDeck: null,
                deckSummary: {
                    colors: ["U"],
                    maindeckCount: 40,
                    sideboardCount: 2,
                },
            },
        ]);
        const { container } = render(
            <LimitedReviewPanel event={event} isAdmin={false} />
        );
        // Exactly one disclosure — the viewer's own seat.
        expect(container.querySelectorAll("details").length).toBe(1);
        expect(tileTitles(blockOf(container, "review-maindeck"))).toEqual([
            "Lightning Bolt",
        ]);
    });

    it("lets an ADMIN expand any seat to see the built deck and the Pool", () => {
        const event = makeEvent({ completed: true, seatsWithDeck: 2 }, [
            {
                seatIndex: 0,
                userId: "user-1",
                nickname: "Alice",
                isViewer: false, // NOT the admin's own seat — admin still sees it
                pool: [{ scryfallId: "s1", ...BOLT }],
                humanDeck: { cards: [BOLT], sideboard: [], colors: ["R"] },
                deckSummary: {
                    colors: ["R"],
                    maindeckCount: 1,
                    sideboardCount: 0,
                },
            },
            {
                seatIndex: 1,
                isBot: true,
                nickname: "Bot 2",
                pool: [{ scryfallId: "s2", ...SERRA }],
                autoBuiltDeck: {
                    cards: [SERRA],
                    sideboard: [],
                    colors: ["R", "G"],
                },
                deckSummary: {
                    colors: ["R", "G"],
                    maindeckCount: 1,
                    sideboardCount: 0,
                },
            },
        ]);
        const { container } = render(
            <LimitedReviewPanel event={event} isAdmin={true} />
        );
        // One disclosure per seat, each drawing its own deck AND its own Pool.
        expect(container.querySelectorAll("details").length).toBe(2);
        expect(tileTitles(container)).toEqual([
            "Lightning Bolt", // seat 0 maindeck
            "Lightning Bolt", // seat 0 Pool
            "Serra Angel", // seat 1 maindeck
            "Serra Angel", // seat 1 Pool
        ]);
    });

    it("shows 'No deck submitted' in an admin's expanded detail for a human seat with no humanDeck", () => {
        const event = makeEvent({ completed: true, seatsWithDeck: 1 }, [
            {
                seatIndex: 0,
                userId: "user-1",
                nickname: "Alice",
                isViewer: false,
                pool: [],
                humanDeck: null,
                deckSummary: null,
            },
        ]);
        const { getByText } = render(
            <LimitedReviewPanel event={event} isAdmin={true} />
        );
        expect(getByText("No deck submitted.")).toBeTruthy();
        // A seat with an empty Pool keeps its own empty state too.
        expect(getByText("No Pool.")).toBeTruthy();
    });
});

describe("LimitedReviewSeat card piles (issue #3167)", () => {
    function sealedSeat(seat: Partial<LimitedEventView["seats"][number]> = {}) {
        return makeEvent({ completed: true, seatsWithDeck: 1 }, [
            {
                seatIndex: 0,
                userId: "user-1",
                nickname: "Alice",
                isViewer: false,
                pool: [
                    { scryfallId: "s1", ...BOLT },
                    { scryfallId: "s2", ...SERRA },
                ],
                humanDeck: {
                    cards: [BOLT, SERRA],
                    sideboard: [SERRA],
                    colors: ["R", "W"],
                },
                deckSummary: {
                    colors: ["R", "W"],
                    maindeckCount: 2,
                    sideboardCount: 1,
                },
                ...seat,
            },
        ]);
    }

    it("draws the built deck as card images in Columns, grouped by Mana Value by default", () => {
        const { container } = render(
            <LimitedReviewPanel event={sealedSeat()} isAdmin={true} />
        );
        const main = blockOf(container, "review-maindeck");
        // Bucketed by MV, not listed by name: Lightning Bolt (MV 1) and Serra
        // Angel (MV 5) land in two different Columns.
        expect(columnLabels(main)).toEqual(["MV 1", "MV 5"]);
        expect(tileTitles(main)).toEqual(["Lightning Bolt", "Serra Angel"]);
        // Every face is a real card image, not a text row.
        expect(main.querySelectorAll("[data-column] img").length).toBe(2);
        expect(
            container.querySelector<HTMLSelectElement>(
                '[aria-label="Built Deck grouping"]'
            )!.value
        ).toBe("mv");
    });

    it("re-buckets the maindeck when the Grouping select changes", () => {
        const { container } = render(
            <LimitedReviewPanel event={sealedSeat()} isAdmin={true} />
        );
        const select = container.querySelector<HTMLSelectElement>(
            '[aria-label="Built Deck grouping"]'
        )!;
        fireEvent.change(select, { target: { value: "color" } });
        expect(columnLabels(blockOf(container, "review-maindeck"))).toEqual([
            "White",
            "Red",
        ]);
        // The Pool's own Grouping is independent state — untouched.
        expect(columnLabels(blockOf(container, "review-pool"))).toEqual([
            "MV 1",
            "MV 5",
        ]);
    });

    it("draws the sideboard as ONE Column with no Grouping select", () => {
        const { container } = render(
            <LimitedReviewPanel event={sealedSeat()} isAdmin={true} />
        );
        const side = blockOf(container, "review-sideboard");
        expect(side.querySelectorAll("[data-column]").length).toBe(1);
        expect(tileTitles(side)).toEqual(["Serra Angel"]);
        expect(
            container.querySelector('[aria-label="Sideboard grouping"]')
        ).toBeNull();
    });

    it("draws a SEALED seat's Pool as grouped card images, with no pick numbers", () => {
        const { container } = render(
            <LimitedReviewPanel event={sealedSeat()} isAdmin={true} />
        );
        const pool = blockOf(container, "review-pool");
        expect(tileTitles(pool)).toEqual(["Lightning Bolt", "Serra Angel"]);
        expect(
            container.querySelector('[aria-label="Pool grouping"]')
        ).toBeTruthy();
        expect(container.querySelector("[data-pick-number]")).toBeNull();
        expect(
            container.querySelector('[data-slot="review-pick-order"]')
        ).toBeNull();
    });

    it("draws a DRAFT seat's pick order as card images in pick sequence, each numbered from 1", () => {
        const event = makeEvent(
            { type: "draft", completed: true, seatsWithDeck: 1 },
            [
                {
                    seatIndex: 0,
                    userId: "user-1",
                    nickname: "Alice",
                    isViewer: false,
                    // Pick 1 is Serra Angel: the block must follow the array,
                    // not re-sort by name or by Mana Value.
                    pool: [
                        { scryfallId: "p1", ...SERRA },
                        { scryfallId: "p2", ...BOLT },
                    ],
                    humanDeck: null,
                    deckSummary: {
                        colors: [],
                        maindeckCount: 0,
                        sideboardCount: 0,
                    },
                },
            ]
        );
        const { container } = render(
            <LimitedReviewPanel event={event} isAdmin={true} />
        );
        const picks = [
            ...blockOf(container, "review-pick-order").querySelectorAll("li"),
        ];
        expect(picks.map((li) => li.getAttribute("title"))).toEqual([
            "Pick 1 — Serra Angel",
            "Pick 2 — Lightning Bolt",
        ]);
        expect(
            picks.map(
                (li) => li.querySelector("[data-pick-number]")!.textContent
            )
        ).toEqual(["1", "2"]);
        // Card FACES, in an ordered list — the order carries the meaning.
        expect(picks.every((li) => li.querySelector("img") !== null)).toBe(
            true
        );
        expect(
            blockOf(container, "review-pick-order").querySelector("ol")
        ).not.toBeNull();
        // A Draft seat has no grouped Pool block.
        expect(container.querySelector('[data-slot="review-pool"]')).toBeNull();
    });

    it("exposes NO editing affordance: no tile gesture, no pin, no column management", () => {
        const { container } = render(
            <LimitedReviewPanel event={sealedSeat()} isAdmin={true} />
        );
        const detail = blockOf(container, "review-seat-detail");
        // The tile's `role="button"` + keyboard grid handle are what a click,
        // an Enter and an arrow-nav all hang off — a read-only tile binds none
        // of them, so it advertises none of them either.
        expect(detail.querySelectorAll('[role="button"]').length).toBe(0);
        expect(detail.querySelectorAll("[data-card-tile]").length).toBe(0);
        expect(detail.querySelectorAll("[tabindex]").length).toBe(0);
        // No column add / rename / delete, and no Ordering control.
        expect(
            container.querySelector('[aria-label*="Add column"]')
        ).toBeNull();
        expect(
            container.querySelector('[aria-label="Built Deck ordering"]')
        ).toBeNull();
    });
});
