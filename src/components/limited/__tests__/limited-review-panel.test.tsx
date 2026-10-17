// "Review the table" (PRD #1107 story 26; issue #5392). Every lock/reveal
// assertion runs on the output of the REAL `projectLimitedEvent` — the seam a
// client actually receives — never a hand-built view: whether a seat is locked
// is the projection's verdict, so the test must be able to see it change.
import { describe, it, expect, afterEach } from "vitest";
import {
    render,
    cleanup,
    fireEvent,
    screen,
    within,
} from "@testing-library/react";
import {
    projectLimitedEvent,
    type LimitedEventRow,
} from "@convex/limited/eventProjection";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedReviewPanel from "../limited-review-panel";

afterEach(() => {
    cleanup();
});

// Real registry ids — `groupDeckCards` resolves each through the card registry.
const BOLT = {
    cardId: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
    cardName: "Lightning Bolt",
};
const BEARS = {
    cardId: "ce2d603a-3231-4a8c-bf39-1617586ea870",
    cardName: "Grizzly Bears",
};
const MOUNTAIN = {
    cardId: "eace2c85-976c-425e-9800-5a6ccbd91b56",
    cardName: "Mountain",
};

const withScry = (cards: { cardId: string; cardName: string }[]) =>
    cards.map((c, i) => ({ scryfallId: `s${i}`, ...c }));

function projected(
    overrides: Partial<LimitedEventRow>,
    humanDecks: "own" | "both" = "own"
): LimitedEventView {
    const row: LimitedEventRow = {
        _id: "event1",
        createdBy: "admin1",
        type: "draft",
        status: "playing",
        seatCount: 2,
        packSlots: ["lea", "lea"],
        sealedBoosterCount: 6,
        seats: [
            {
                seatIndex: 0,
                userId: "user1",
                nickname: "Alice",
                pool: withScry([BOLT, BEARS, MOUNTAIN, MOUNTAIN]),
            },
            {
                seatIndex: 1,
                userId: "user2",
                nickname: "Bob",
                pool: withScry([BEARS]),
            },
        ],
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    };
    const deck = (cards: { cardId: string; cardName: string }[]) => ({
        cards,
        sideboard: [BOLT],
        colors: ["R"],
    });
    const decks = new Map([[0, deck([BOLT, BEARS, MOUNTAIN, MOUNTAIN])]]);
    if (humanDecks === "both") decks.set(1, deck([BEARS]));
    return projectLimitedEvent(
        row,
        "user1",
        true,
        2,
        decks as never,
        new Set([0, 1])
    ) as unknown as LimitedEventView;
}

const seatEl = (i: number) =>
    document.querySelector<HTMLElement>(`[data-seat-index="${i}"]`)!;

describe("LimitedReviewPanel — locked vs revealed follows the projection", () => {
    it("Play Phase, no Open Decklists: own seat open, the other locked with its note, no banner", () => {
        render(<LimitedReviewPanel event={projected({})} />);
        expect(seatEl(0).getAttribute("data-locked")).toBe("false");
        expect(
            seatEl(0).querySelector("[data-slot=review-seat-detail]")
        ).not.toBeNull();
        expect(seatEl(1).getAttribute("data-locked")).toBe("true");
        expect(seatEl(1).textContent).toContain("Revealed when the event ends");
        expect(seatEl(1).querySelector("button")).toBeNull();
        expect(
            document.querySelector("[data-slot=open-decklists-notice]")
        ).toBeNull();
    });

    it("Play Phase with Open Decklists: both seats revealed, banner shown", () => {
        render(
            <LimitedReviewPanel
                event={projected({ openDecklists: true }, "both")}
            />
        );
        expect(seatEl(1).getAttribute("data-locked")).toBe("false");
        expect(
            document.querySelector("[data-slot=open-decklists-notice]")!
                .textContent
        ).toContain("Open Decklists is on");
    });

    it("finished: every seat revealed, no Open Decklists banner", () => {
        render(
            <LimitedReviewPanel
                event={projected({ status: "finished" }, "both")}
            />
        );
        expect(seatEl(1).getAttribute("data-locked")).toBe("false");
        expect(
            document.querySelector("[data-slot=open-decklists-notice]")
        ).toBeNull();
    });

    it("never reveals a bot's auto-built deck the projection did not reveal", () => {
        const event = projected({});
        event.seats[1] = {
            ...event.seats[1],
            isBot: true,
            autoBuiltDeck: { cards: [BEARS], sideboard: [], colors: ["G"] },
        };
        render(<LimitedReviewPanel event={event} />);
        expect(seatEl(1).getAttribute("data-locked")).toBe("true");
        expect(seatEl(1).querySelector("img")).toBeNull();
    });
});

describe("LimitedReviewPanel — a seat's Deck / Pick order tabs and zoom", () => {
    it("Deck tab: creatures / spells / lands, basics collapsed to ×N, then the sideboard", () => {
        render(<LimitedReviewPanel event={projected({})} />);
        const deck = seatEl(0).querySelector("[data-slot=review-deck]")!;
        const groups = [...deck.querySelectorAll("[data-group]")].map((g) =>
            g.getAttribute("data-group")
        );
        expect(groups).toEqual(["creatures", "spells", "lands", "sideboard"]);
        const lands = deck.querySelector("[data-group=lands]")!;
        expect(lands.querySelectorAll("li")).toHaveLength(1);
        expect(lands.querySelector("[data-slot=card-count]")!.textContent).toBe(
            "×2"
        );
        expect(lands.querySelector("h4")!.textContent).toBe("Lands · 2");
    });

    it("Pick order tab: faces captioned P1p1… in pool order, 2 packs of 2", () => {
        render(<LimitedReviewPanel event={projected({})} />);
        fireEvent.click(screen.getByRole("radio", { name: /Pick order/ }));
        const order = seatEl(0).querySelector("[data-slot=review-pick-order]")!;
        expect(
            [...order.querySelectorAll("li")].map((li) =>
                li.getAttribute("title")
            )
        ).toEqual([
            "P1p1 — Lightning Bolt",
            "P1p2 — Grizzly Bears",
            "P2p1 — Mountain",
            "P2p2 — Mountain",
        ]);
    });

    it("tab choice is per seat; opening one seat closes the other", () => {
        render(
            <LimitedReviewPanel
                event={projected({ openDecklists: true }, "both")}
            />
        );
        fireEvent.click(seatEl(1).querySelector("button")!);
        expect(
            seatEl(0).querySelector("[data-slot=review-seat-detail]")
        ).toBeNull();
        fireEvent.click(
            within(seatEl(1)).getByRole("radio", { name: /Pick order/ })
        );
        fireEvent.click(seatEl(0).querySelector("button")!);
        expect(
            seatEl(0).querySelector("[data-slot=review-deck]")
        ).not.toBeNull();
        fireEvent.click(seatEl(1).querySelector("button")!);
        expect(seatEl(1).querySelector("[data-slot=review-deck]")).toBeNull();
        expect(
            seatEl(1).querySelector("[data-slot=review-pick-order]")
        ).not.toBeNull();
    });

    it("zoom slider resizes the cards; chevron trigger collapses the seat", () => {
        render(<LimitedReviewPanel event={projected({})} />);
        const slider = screen.getByLabelText("Card size") as HTMLInputElement;
        fireEvent.change(slider, { target: { value: "200" } });
        expect(
            seatEl(0)
                .querySelector<HTMLElement>("ul")!
                .style.getPropertyValue("--card-w")
        ).toBe("200px");
        fireEvent.click(seatEl(0).querySelector("button")!);
        expect(
            seatEl(0).querySelector("[data-slot=review-seat-detail]")
        ).toBeNull();
    });

    it("a Sealed seat's second tab is its Pool, unnumbered", () => {
        render(<LimitedReviewPanel event={projected({ type: "sealed" })} />);
        fireEvent.click(screen.getByRole("radio", { name: /Pool/ }));
        const pool = seatEl(0).querySelector("[data-slot=review-pool]")!;
        expect(pool.querySelector("[data-slot=card-caption]")).toBeNull();
        expect(pool.querySelectorAll("li")).toHaveLength(4);
    });
});

// Issue #5473: a set-bound event's reprint is shown with the printing its
// booster contained — the Pool entry's `scryfallId` — and a saved deck entry
// (`cardId` = the opened print, `definitionId` = canonical, ADR 0140 §5) is
// both drawn from its print and still classified by its definition.
describe("LimitedReviewPanel — shows the opened print (issue #5473)", () => {
    const OPENED_PRINT = "tmp-bolt-print";

    function reprintEvent(): LimitedEventView {
        const row: LimitedEventRow = {
            _id: "event1",
            createdBy: "admin1",
            type: "draft",
            status: "playing",
            seatCount: 1,
            packSlots: ["lea"],
            sealedBoosterCount: 6,
            seats: [
                {
                    seatIndex: 0,
                    userId: "user1",
                    nickname: "Alice",
                    pool: [{ scryfallId: OPENED_PRINT, ...BOLT }],
                },
            ],
            createdAt: 0,
            updatedAt: 0,
        };
        const printed = {
            cardId: OPENED_PRINT,
            cardName: BOLT.cardName,
            definitionId: BOLT.cardId,
        };
        return projectLimitedEvent(
            row,
            "user1",
            true,
            1,
            new Map([
                [0, { cards: [printed], sideboard: [printed], colors: ["R"] }],
            ]) as never,
            new Set([0])
        ) as unknown as LimitedEventView;
    }

    const faces = (root: Element) =>
        [...root.querySelectorAll<HTMLImageElement>("img")].map((i) => i.src);

    it("Deck tab: draws the saved print and still files the card under Spells", () => {
        render(<LimitedReviewPanel event={reprintEvent()} />);
        const deck = seatEl(0).querySelector("[data-slot=review-deck]")!;
        expect(deck.querySelector("[data-group=spells] h4")!.textContent).toBe(
            "Spells · 1"
        );
        const srcs = faces(deck);
        expect(srcs.length).toBeGreaterThan(0);
        for (const src of srcs) {
            expect(src).toContain(OPENED_PRINT);
            expect(src).not.toContain(BOLT.cardId);
        }
    });

    it("Pick order tab: draws the Pool entry's scryfallId, not its canonical Card ID", () => {
        render(<LimitedReviewPanel event={reprintEvent()} />);
        fireEvent.click(screen.getByRole("radio", { name: /Pick order/ }));
        const order = seatEl(0).querySelector("[data-slot=review-pick-order]")!;
        const srcs = faces(order);
        expect(srcs.length).toBeGreaterThan(0);
        for (const src of srcs) {
            expect(src).toContain(OPENED_PRINT);
            expect(src).not.toContain(BOLT.cardId);
        }
    });
});
