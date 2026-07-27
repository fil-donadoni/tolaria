// Event projection privacy tests (PRD #1107 story 15/26, ADR 0054/0055, issue
// #1110). This is the "wire format" mandatory test for the privacy boundary:
// assertions run against `projectLimitedEvent`'s OUTPUT — the same seam a
// client actually receives — not a hand-built view.
import { describe, it, expect } from "vitest";
import { projectLimitedEvent, type LimitedEventRow } from "../eventProjection";

function row(overrides: Partial<LimitedEventRow> = {}): LimitedEventRow {
    return {
        _id: "event1",
        createdBy: "admin1",
        type: "sealed",
        status: "started",
        seatCount: 2,
        packSlots: ["lea"],
        sealedBoosterCount: 6,
        seats: [
            {
                seatIndex: 0,
                userId: "user1",
                nickname: "Alice",
                pool: [
                    { scryfallId: "s1", cardId: "c1", cardName: "Card One" },
                    { scryfallId: "s2", cardId: "c2", cardName: "Card Two" },
                ],
            },
            {
                seatIndex: 1,
                userId: "user2",
                nickname: "Bob",
                pool: [
                    { scryfallId: "s3", cardId: "c3", cardName: "Card Three" },
                ],
            },
        ],
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    };
}

describe("projectLimitedEvent (ADR 0054/0055, PRD #1107 story 15/26)", () => {
    it("reveals the viewer's own seat's full pool", () => {
        const view = projectLimitedEvent(row(), "user1");
        const own = view.seats.find((s) => s.seatIndex === 0)!;
        expect(own.isViewer).toBe(true);
        expect(own.pool).toEqual([
            { scryfallId: "s1", cardId: "c1", cardName: "Card One" },
            { scryfallId: "s2", cardId: "c2", cardName: "Card Two" },
        ]);
    });

    it("strips every OTHER seat's pool contents", () => {
        const view = projectLimitedEvent(row(), "user1");
        const other = view.seats.find((s) => s.seatIndex === 1)!;
        expect(other.isViewer).toBe(false);
        expect(other.pool).toBeNull();
    });

    it("still exposes poolCount for every seat, including hidden ones", () => {
        const view = projectLimitedEvent(row(), "user1");
        expect(view.seats.find((s) => s.seatIndex === 0)!.poolCount).toBe(2);
        expect(view.seats.find((s) => s.seatIndex === 1)!.poolCount).toBe(1);
    });

    it("a viewer with no seat sees every pool stripped", () => {
        const view = projectLimitedEvent(row(), "outsider");
        expect(view.seats.every((s) => s.pool === null)).toBe(true);
        expect(view.seats.every((s) => !s.isViewer)).toBe(true);
        // Pool counts are still visible to a non-seated viewer.
        expect(view.seats.map((s) => s.poolCount)).toEqual([2, 1]);
    });

    it("a null viewer (defensive default) sees every pool stripped", () => {
        const view = projectLimitedEvent(row(), null);
        expect(view.seats.every((s) => s.pool === null)).toBe(true);
    });

    it("poolCount is null before the event starts (no pool generated yet)", () => {
        const open = row({
            status: "open",
            seats: [{ seatIndex: 0, userId: "user1", nickname: "Alice" }],
        });
        const view = projectLimitedEvent(open, "user1");
        expect(view.seats[0].poolCount).toBeNull();
        expect(view.seats[0].pool).toBeNull();
    });

    it("marks a bot seat and defaults isBot to false when absent", () => {
        const withBot = row({
            seats: [
                { seatIndex: 0, userId: "user1", nickname: "Alice" },
                { seatIndex: 1, isBot: true, nickname: "Bot 2" },
            ],
        });
        const view = projectLimitedEvent(withBot, "user1");
        expect(view.seats[0].isBot).toBe(false);
        expect(view.seats[1].isBot).toBe(true);
    });

    it("carries the event-level metadata through unchanged", () => {
        const view = projectLimitedEvent(row(), "user1");
        expect(view._id).toBe("event1");
        expect(view.type).toBe("sealed");
        expect(view.status).toBe("started");
        expect(view.seatCount).toBe(2);
        expect(view.packSlots).toEqual(["lea"]);
        expect(view.sealedBoosterCount).toBe(6);
    });
});

describe("projectLimitedEvent — Draft privacy (issue #1112, PRD #1107 story 15)", () => {
    function draftRow(
        overrides: Partial<LimitedEventRow> = {}
    ): LimitedEventRow {
        return row({
            type: "draft",
            packSlots: ["lea", "lea", "lea"],
            sealedBoosterCount: undefined,
            draftRound: 0,
            draftPacksRemaining: 2,
            seats: [
                {
                    seatIndex: 0,
                    userId: "user1",
                    nickname: "Alice",
                    pool: [
                        {
                            scryfallId: "p1",
                            cardId: "p1",
                            cardName: "Pick One",
                        },
                    ],
                    currentPack: [
                        {
                            scryfallId: "s1",
                            cardId: "c1",
                            cardName: "Card One",
                            pickId: "r0-p0-c0",
                        },
                        {
                            scryfallId: "s2",
                            cardId: "c2",
                            cardName: "Card Two",
                            pickId: "r0-p0-c1",
                        },
                    ],
                    packQueue: [
                        [
                            {
                                scryfallId: "s3",
                                cardId: "c3",
                                cardName: "Card Three",
                                pickId: "r0-p1-c0",
                            },
                        ],
                    ],
                },
                {
                    seatIndex: 1,
                    userId: "user2",
                    nickname: "Bob",
                    pool: [],
                    currentPack: [
                        {
                            scryfallId: "s4",
                            cardId: "c4",
                            cardName: "Card Four",
                            pickId: "r0-p1-c1",
                        },
                    ],
                    packQueue: [],
                },
            ],
            ...overrides,
        });
    }

    it("reveals the viewer's own currentPack and packQueueCount", () => {
        const view = projectLimitedEvent(draftRow(), "user1");
        const own = view.seats.find((s) => s.seatIndex === 0)!;
        expect(own.currentPack).toEqual([
            {
                scryfallId: "s1",
                cardId: "c1",
                cardName: "Card One",
                pickId: "r0-p0-c0",
            },
            {
                scryfallId: "s2",
                cardId: "c2",
                cardName: "Card Two",
                pickId: "r0-p0-c1",
            },
        ]);
        expect(own.packQueueCount).toBe(1);
    });

    it("strips every OTHER seat's currentPack contents and packQueueCount", () => {
        const view = projectLimitedEvent(draftRow(), "user1");
        const other = view.seats.find((s) => s.seatIndex === 1)!;
        expect(other.currentPack).toBeNull();
        expect(other.packQueueCount).toBeNull();
    });

    it("an outsider (no seat) sees every currentPack stripped", () => {
        const view = projectLimitedEvent(draftRow(), "outsider");
        expect(view.seats.every((s) => s.currentPack === null)).toBe(true);
        expect(view.seats.every((s) => s.packQueueCount === null)).toBe(true);
    });

    it("carries draftRound/draftPacksRemaining/draftCompletedAt through unchanged", () => {
        const view = projectLimitedEvent(
            draftRow({ draftRound: 1, draftPacksRemaining: 2 }),
            "user1"
        );
        expect(view.draftRound).toBe(1);
        expect(view.draftPacksRemaining).toBe(2);
        expect(view.draftCompletedAt).toBeUndefined();
    });

    it("exposes draftCompletedAt once the draft finishes", () => {
        const view = projectLimitedEvent(
            draftRow({ draftCompletedAt: 12345 }),
            "user1"
        );
        expect(view.draftCompletedAt).toBe(12345);
    });

    it("a Sealed event's seats never carry currentPack/packQueueCount info beyond null", () => {
        const view = projectLimitedEvent(row(), "user1");
        for (const seat of view.seats) {
            expect(seat.currentPack).toBeNull();
        }
    });
});

describe("projectLimitedEvent — completion full-disclosure reveal (issue #1116, PRD #1107 story 26)", () => {
    const humanDecks = new Map([
        [
            0,
            {
                cards: [{ cardId: "c1", cardName: "Card One" }],
                sideboard: [{ cardId: "c2", cardName: "Card Two" }],
                colors: ["W"],
            },
        ],
    ]);

    // --- Direction 1: DURING the event (completed omitted/false) — every
    // other seat's Pool AND humanDeck STILL stripped, exactly like the
    // pre-#1116 privacy tests above. This is the "strips during" half of the
    // mandatory both-directions wire-format test.
    it("before completion: every other seat's pool is still stripped, humanDeck is always null", () => {
        const view = projectLimitedEvent(row(), "user1", false, 1, humanDecks);
        const own = view.seats.find((s) => s.seatIndex === 0)!;
        const other = view.seats.find((s) => s.seatIndex === 1)!;
        expect(view.completed).toBe(false);
        expect(own.pool).not.toBeNull(); // still visible: it's the VIEWER'S own seat
        expect(other.pool).toBeNull(); // every other seat stays hidden
        expect(own.humanDeck).toBeNull(); // humanDeck NEVER reveals pre-completion
        expect(other.humanDeck).toBeNull();
    });

    it("before completion: even a call site that forgets the extra params defaults to not-completed (backward compatible)", () => {
        const view = projectLimitedEvent(row(), "user1");
        expect(view.completed).toBe(false);
        expect(view.seatsWithDeck).toBe(0);
        expect(view.seats.find((s) => s.seatIndex === 1)!.pool).toBeNull();
    });

    // --- Direction 2: AFTER completion — the debug detail (pool card list +
    // built deck) reveals for another seat ONLY to an ADMIN viewer (issue
    // #1583). The viewer's OWN seat always reveals, admin or not. This is the
    // "reveals at completion, for admins" half of the mandatory test.
    it("after completion: an ADMIN viewer sees every OTHER seat's pool", () => {
        const view = projectLimitedEvent(
            row(),
            "user1",
            true,
            2,
            humanDecks,
            new Set<number>(),
            true // isAdmin
        );
        expect(view.completed).toBe(true);
        expect(view.seatsWithDeck).toBe(2);
        const other = view.seats.find((s) => s.seatIndex === 1)!;
        expect(other.pool).toEqual([
            { scryfallId: "s3", cardId: "c3", cardName: "Card Three" },
        ]);
    });

    it("after completion: a NON-ADMIN viewer never receives another seat's pool or humanDeck (issue #1583)", () => {
        const view = projectLimitedEvent(row(), "user1", true, 2, humanDecks);
        const own = view.seats.find((s) => s.seatIndex === 0)!;
        const other = view.seats.find((s) => s.seatIndex === 1)!;
        // Own seat still fully visible.
        expect(own.pool).not.toBeNull();
        // Every OTHER seat's card list stays stripped for a non-admin.
        expect(other.pool).toBeNull();
        expect(other.humanDeck).toBeNull();
    });

    it("after completion: a viewer sees their OWN seat's submitted deck via humanDeck (admin not required)", () => {
        const view = projectLimitedEvent(row(), "user1", true, 2, humanDecks);
        const seat0 = view.seats.find((s) => s.seatIndex === 0)!;
        expect(seat0.humanDeck).toEqual({
            cards: [{ cardId: "c1", cardName: "Card One" }],
            sideboard: [{ cardId: "c2", cardName: "Card Two" }],
            colors: ["W"],
        });
    });

    it("after completion: an ADMIN viewer sees another seat's submitted deck via humanDeck", () => {
        // Deck lives on seat 0; the ADMIN viewer is seated at seat 1.
        const view = projectLimitedEvent(
            row(),
            "user2",
            true,
            2,
            humanDecks,
            new Set<number>(),
            true // isAdmin
        );
        const seat0 = view.seats.find((s) => s.seatIndex === 0)!;
        expect(seat0.isViewer).toBe(false);
        expect(seat0.humanDeck).toEqual({
            cards: [{ cardId: "c1", cardName: "Card One" }],
            sideboard: [{ cardId: "c2", cardName: "Card Two" }],
            colors: ["W"],
        });
    });

    it("after completion: a human seat with no entry in humanDecksBySeat reveals humanDeck: null to an admin (never throws)", () => {
        const view = projectLimitedEvent(
            row(),
            "user1",
            true,
            1,
            humanDecks,
            new Set<number>(),
            true
        );
        const seat1 = view.seats.find((s) => s.seatIndex === 1)!;
        expect(seat1.humanDeck).toBeNull();
        expect(seat1.pool).not.toBeNull(); // pool still reveals to the admin
    });

    it("after completion: a bot seat's humanDeck is always null (its deck is autoBuiltDeck, computed elsewhere)", () => {
        const withBot = row({
            seats: [
                row().seats[0],
                { seatIndex: 1, isBot: true, nickname: "Bot 2", pool: [] },
            ],
        });
        const view = projectLimitedEvent(
            withBot,
            "user1",
            true,
            1,
            new Map(),
            new Set<number>(),
            true
        );
        const botSeat = view.seats.find((s) => s.seatIndex === 1)!;
        expect(botSeat.isBot).toBe(true);
        expect(botSeat.humanDeck).toBeNull();
    });

    it("after completion: a NON-PARTICIPANT non-admin viewer receives NO pool/deck contents (issue #1583)", () => {
        const view = projectLimitedEvent(
            row(),
            "outsider",
            true,
            2,
            humanDecks
        );
        expect(view.seats.every((s) => !s.isViewer)).toBe(true);
        expect(view.seats.every((s) => s.pool === null)).toBe(true);
        expect(view.seats.every((s) => s.humanDeck === null)).toBe(true);
    });

    it("after completion: a NON-PARTICIPANT ADMIN viewer sees every seat's pool/deck (post-mortem study)", () => {
        const view = projectLimitedEvent(
            row(),
            "outsider-admin",
            true,
            2,
            humanDecks,
            new Set<number>(),
            true
        );
        expect(view.seats.every((s) => !s.isViewer)).toBe(true);
        expect(view.seats.every((s) => s.pool !== null)).toBe(true);
        expect(
            view.seats.find((s) => s.seatIndex === 0)!.humanDeck
        ).not.toBeNull();
    });

    it("after completion: a null (unauthenticated/defensive) viewer — never admin — receives no pool contents", () => {
        const view = projectLimitedEvent(row(), null, true, 2, humanDecks);
        expect(view.seats.every((s) => s.pool === null)).toBe(true);
    });

    it("every viewer still gets each seat's compact deckSummary (colors + counts), admin or not (issue #1583)", () => {
        const view = projectLimitedEvent(
            row(),
            "outsider",
            true,
            2,
            humanDecks
        );
        const seat0 = view.seats.find((s) => s.seatIndex === 0)!;
        // seat 0 has a submitted human deck — its summary is exposed even to a
        // non-admin non-participant, though its card list (pool/humanDeck) is not.
        expect(seat0.deckSummary).toEqual({
            colors: ["W"],
            maindeckCount: 1,
            sideboardCount: 1,
        });
        expect(seat0.pool).toBeNull();
        expect(seat0.humanDeck).toBeNull();
        // seat 1 has no human deck in the map — pure projection leaves its
        // summary null (the query shell fills a bot seat's from autoBuiltDeck).
        expect(
            view.seats.find((s) => s.seatIndex === 1)!.deckSummary
        ).toBeNull();
    });

    it("for a DRAFT event, the admin-revealed pool's array order IS the seat's pick order — never reordered by the projection", () => {
        const draft = row({
            type: "draft",
            packSlots: ["lea", "lea"],
            seats: [
                {
                    seatIndex: 0,
                    userId: "user1",
                    nickname: "Alice",
                    pool: [
                        {
                            scryfallId: "p1",
                            cardId: "p1",
                            cardName: "First Pick",
                        },
                        {
                            scryfallId: "p2",
                            cardId: "p2",
                            cardName: "Second Pick",
                        },
                        {
                            scryfallId: "p3",
                            cardId: "p3",
                            cardName: "Third Pick",
                        },
                    ],
                },
            ],
            draftCompletedAt: 999,
        });
        const view = projectLimitedEvent(
            draft,
            "someone-else",
            true,
            1,
            new Map(),
            new Set<number>(),
            true // admin — the debug pick-order detail is admin-gated (#1583)
        );
        const seat = view.seats.find((s) => s.seatIndex === 0)!;
        expect(seat.pool!.map((c) => c.cardName)).toEqual([
            "First Pick",
            "Second Pick",
            "Third Pick",
        ]);
    });
});

describe("projectLimitedEvent — timerEnabled (ADR 0060, issue #1243)", () => {
    it("preserves timerEnabled: true through the projection — event-wide config, never hidden", () => {
        const view = projectLimitedEvent(
            row({ type: "draft", timerEnabled: true }),
            "user1"
        );
        expect(view.timerEnabled).toBe(true);
    });

    it("preserves an absent timerEnabled (timer off) as undefined", () => {
        const view = projectLimitedEvent(row({ type: "draft" }), "user1");
        expect(view.timerEnabled).toBeUndefined();
    });
});

describe("projectLimitedEvent — poolArrangement (ADR 0060, issue #1247)", () => {
    it("preserves the viewer's own seat's Pool Arrangement", () => {
        const event = row({
            seats: [
                {
                    seatIndex: 0,
                    userId: "user1",
                    nickname: "Alice",
                    pool: [
                        {
                            scryfallId: "s1",
                            cardId: "c1",
                            cardName: "Card One",
                        },
                    ],
                    poolArrangement: [{ poolIndex: 0, sideboard: true }],
                },
                {
                    seatIndex: 1,
                    userId: "user2",
                    nickname: "Bob",
                    pool: [
                        {
                            scryfallId: "s3",
                            cardId: "c3",
                            cardName: "Card Three",
                        },
                    ],
                    poolArrangement: [{ poolIndex: 0, column: 2 }],
                },
            ],
        });

        const view = projectLimitedEvent(event, "user1");
        const own = view.seats.find((s) => s.seatIndex === 0)!;
        expect(own.poolArrangement).toEqual([
            { poolIndex: 0, sideboard: true },
        ]);
    });

    it("strips every OTHER seat's Pool Arrangement — same 'own seat only' discipline as currentPack/pickDeadline", () => {
        const event = row({
            seats: [
                {
                    seatIndex: 0,
                    userId: "user1",
                    nickname: "Alice",
                    pool: [
                        {
                            scryfallId: "s1",
                            cardId: "c1",
                            cardName: "Card One",
                        },
                    ],
                    poolArrangement: [{ poolIndex: 0, sideboard: true }],
                },
                {
                    seatIndex: 1,
                    userId: "user2",
                    nickname: "Bob",
                    pool: [
                        {
                            scryfallId: "s3",
                            cardId: "c3",
                            cardName: "Card Three",
                        },
                    ],
                    poolArrangement: [{ poolIndex: 0, column: 2 }],
                },
            ],
        });

        const view = projectLimitedEvent(event, "user1");
        const other = view.seats.find((s) => s.seatIndex === 1)!;
        expect(other.poolArrangement).toBeNull();
    });

    it("projects to null (not an empty array) for a viewer's own seat with no Arrangement recorded yet", () => {
        const view = projectLimitedEvent(row(), "user1");
        const own = view.seats.find((s) => s.seatIndex === 0)!;
        expect(own.poolArrangement).toBeNull();
    });

    it("a viewer with no seat sees every seat's Arrangement stripped", () => {
        const view = projectLimitedEvent(
            row({
                seats: [
                    {
                        seatIndex: 0,
                        userId: "user1",
                        pool: [],
                        poolArrangement: [{ poolIndex: 0, sideboard: true }],
                    },
                ],
            }),
            "outsider"
        );
        expect(view.seats.every((s) => s.poolArrangement === null)).toBe(true);
    });
});

describe("projectLimitedEvent — hasDeck per-seat readiness (issue #1580)", () => {
    it("defaults every seat's hasDeck to false when a caller passes no hasDeckBySeat (backward compatible)", () => {
        const view = projectLimitedEvent(row(), "user1");
        expect(view.seats.every((s) => s.hasDeck === false)).toBe(true);
    });

    it("marks exactly the seats present in hasDeckBySeat as ready", () => {
        const view = projectLimitedEvent(
            row(),
            "user1",
            false,
            1,
            new Map(),
            new Set([1])
        );
        expect(view.seats.find((s) => s.seatIndex === 0)!.hasDeck).toBe(false);
        expect(view.seats.find((s) => s.seatIndex === 1)!.hasDeck).toBe(true);
    });

    it("surfaces hasDeck for a NON-viewer seat too — it's a readiness flag, not the deck's contents", () => {
        const view = projectLimitedEvent(
            row(),
            "user1",
            false,
            1,
            new Map(),
            new Set([1])
        );
        const other = view.seats.find((s) => s.seatIndex === 1)!;
        expect(other.isViewer).toBe(false);
        expect(other.hasDeck).toBe(true);
        // The flag is visible, but the deck's CONTENTS stay hidden pre-
        // completion — proves the readiness signal never leaks the pool.
        expect(other.pool).toBeNull();
        expect(other.humanDeck).toBeNull();
    });

    it("hasDeck stays readable before AND after completion — unlike pool/humanDeck, it's never itself gated on completed", () => {
        const beforeCompletion = projectLimitedEvent(
            row(),
            "outsider",
            false,
            1,
            new Map(),
            new Set([0])
        );
        const afterCompletion = projectLimitedEvent(
            row(),
            "outsider",
            true,
            2,
            new Map(),
            new Set([0, 1])
        );
        expect(
            beforeCompletion.seats.find((s) => s.seatIndex === 0)!.hasDeck
        ).toBe(true);
        expect(
            afterCompletion.seats.find((s) => s.seatIndex === 1)!.hasDeck
        ).toBe(true);
    });
});

describe("projectLimitedEvent — selectedPickId (ADR 0060, issue #1248)", () => {
    it("preserves the viewer's own seat's Selected Card", () => {
        const event = row({
            type: "draft",
            seats: [
                {
                    seatIndex: 0,
                    userId: "user1",
                    nickname: "Alice",
                    pool: [],
                    currentPack: [
                        {
                            scryfallId: "s1",
                            cardId: "c1",
                            cardName: "Card One",
                            pickId: "r0-p0-c0",
                        },
                    ],
                    selectedPickId: "r0-p0-c0",
                },
                { seatIndex: 1, userId: "user2", nickname: "Bob", pool: [] },
            ],
        });

        const view = projectLimitedEvent(event, "user1");
        const own = view.seats.find((s) => s.seatIndex === 0)!;
        expect(own.selectedPickId).toBe("r0-p0-c0");
    });

    it("strips every OTHER seat's Selected Card — same 'own seat only' discipline as currentPack/pickDeadline/poolArrangement", () => {
        const event = row({
            type: "draft",
            seats: [
                {
                    seatIndex: 0,
                    userId: "user1",
                    nickname: "Alice",
                    pool: [],
                    selectedPickId: "r0-p0-c0",
                },
                {
                    seatIndex: 1,
                    userId: "user2",
                    nickname: "Bob",
                    pool: [],
                    selectedPickId: "r0-p1-c0",
                },
            ],
        });

        const view = projectLimitedEvent(event, "user1");
        const other = view.seats.find((s) => s.seatIndex === 1)!;
        expect(other.selectedPickId).toBeNull();
    });

    it("stays stripped for a NON-participant viewer too — never reveals via the completion full-disclosure flip (unlike pool)", () => {
        const event = row({
            type: "draft",
            draftCompletedAt: 999,
            seats: [
                {
                    seatIndex: 0,
                    userId: "user1",
                    nickname: "Alice",
                    pool: [],
                    selectedPickId: "r0-p0-c0",
                },
                { seatIndex: 1, userId: "user2", nickname: "Bob", pool: [] },
            ],
        });

        const view = projectLimitedEvent(
            event,
            "outsider-admin",
            true,
            2,
            new Map(),
            new Set<number>(),
            true // admin — so the pool reveals and the contrast below holds
        );
        const alice = view.seats.find((s) => s.seatIndex === 0)!;
        expect(alice.selectedPickId).toBeNull();
        // The Pool itself DOES reveal post-completion to an admin — proves the
        // strip is specific to `selectedPickId`, not an accidental full lockdown.
        expect(alice.pool).not.toBeNull();
    });

    it("projects to null (not an empty string) for a viewer's own seat with nothing selected", () => {
        const event = row({
            type: "draft",
            seats: [
                { seatIndex: 0, userId: "user1", nickname: "Alice", pool: [] },
                { seatIndex: 1, userId: "user2", nickname: "Bob", pool: [] },
            ],
        });
        const view = projectLimitedEvent(event, "user1");
        const own = view.seats.find((s) => s.seatIndex === 0)!;
        expect(own.selectedPickId).toBeNull();
    });
});

// --- Play phase on the wire (PRD #1628, ADR 0076, issue #1640) -------------
// The mandatory wire-format assertions for the play-phase fields: every one is
// checked against `projectLimitedEvent`'s OUTPUT — the exact object a client
// receives — because a field the projection drops is this project's single
// most recurring bug class, and a hand-built view would mask it entirely.
describe("play phase projection (PRD #1628, ADR 0076, issue #1640)", () => {
    it("defaults an absent matchFormat to Bo3 on the wire (never undefined)", () => {
        // An event created before the play phase existed: the stored field is
        // absent, but the client must still receive a concrete format.
        const view = projectLimitedEvent(row(), "user1");
        expect(view.matchFormat).toBe("bo3");
    });

    it("carries an explicitly chosen Bo1 through the projection", () => {
        const view = projectLimitedEvent(row({ matchFormat: "bo1" }), "user1");
        expect(view.matchFormat).toBe("bo1");
    });

    it("carries an explicitly chosen Bo3 through the projection", () => {
        const view = projectLimitedEvent(row({ matchFormat: "bo3" }), "user1");
        expect(view.matchFormat).toBe("bo3");
    });

    it("carries the round deadline, and keeps 'no deadline' absent", () => {
        expect(
            projectLimitedEvent(row({ roundDeadlineMinutes: 50 }), "user1")
                .roundDeadlineMinutes
        ).toBe(50);
        expect(
            projectLimitedEvent(row(), "user1").roundDeadlineMinutes
        ).toBeUndefined();
    });

    it("normalises rounds to an empty array before the play phase", () => {
        const view = projectLimitedEvent(row(), "user1");
        expect(view.rounds).toEqual([]);
        expect(view.currentRound).toBeUndefined();
    });

    it("projects rounds, pairings and results to EVERY viewer (public, not viewer-scoped)", () => {
        const event = row({
            status: "playing",
            currentRound: 2,
            rounds: [
                {
                    roundNumber: 1,
                    startedAt: 1000,
                    deadlineAt: 4000,
                    pairings: [
                        {
                            seatA: 0,
                            seatB: 1,
                            matchId: "match1",
                            result: { winsA: 2, winsB: 1, source: "played" },
                        },
                    ],
                },
                {
                    roundNumber: 2,
                    startedAt: 5000,
                    pairings: [{ seatA: 1, seatB: 0 }],
                },
            ],
        });

        // Seat 0's viewer, seat 1's viewer and an anonymous read must all see
        // the identical pairing history — pools/decks are stripped per seat,
        // pairings and results are not.
        for (const viewer of ["user1", "user2", null]) {
            const view = projectLimitedEvent(event, viewer);
            expect(view.status).toBe("playing");
            expect(view.currentRound).toBe(2);
            expect(view.rounds).toHaveLength(2);
            expect(view.rounds[0].pairings[0]).toEqual({
                seatA: 0,
                seatB: 1,
                matchId: "match1",
                result: { winsA: 2, winsB: 1, source: "played" },
            });
            // Undecided pairing stays undecided (no fabricated result).
            expect(view.rounds[1].pairings[0].result).toBeUndefined();
        }
    });

    it("preserves a bye (absent seatB) and every result source verbatim", () => {
        const event = row({
            status: "finished",
            currentRound: 1,
            rounds: [
                {
                    roundNumber: 1,
                    startedAt: 0,
                    pairings: [
                        {
                            seatA: 0,
                            result: { winsA: 2, winsB: 0, source: "bye" },
                        },
                        {
                            seatA: 1,
                            seatB: 2,
                            result: { winsA: 2, winsB: 1, source: "simulated" },
                        },
                        {
                            seatA: 3,
                            seatB: 4,
                            result: { winsA: 0, winsB: 2, source: "timeout" },
                        },
                    ],
                },
            ],
        });
        const view = projectLimitedEvent(event, "user1");
        const pairings = view.rounds[0].pairings;
        expect(pairings[0].seatB).toBeUndefined();
        expect(pairings.map((p) => p.result?.source)).toEqual([
            "bye",
            "simulated",
            "timeout",
        ]);
    });

    it("keeps every pre-play-phase field working on an event with no play state", () => {
        // Backward compatibility (issue #1640 AC): an event row written before
        // the play phase carries none of the new fields and must project
        // exactly as it always did.
        const view = projectLimitedEvent(row(), "user1");
        expect(view.status).toBe("started");
        expect(view.seats).toHaveLength(2);
        expect(view.seats[0].pool).toHaveLength(2);
        expect(view.seats[1].pool).toBeNull();
    });
});

// Standings (PRD #1628 stories 22-24/47, issue #1643) — the mandatory wire
// format test: `computeStandings` has its own full unit coverage
// (`standings.test.ts`), but the AC ("the standings reach the client through
// the event projection and are asserted THROUGH that projection") requires
// asserting the SAME behavior against `projectLimitedEvent`'s actual output,
// never a hand-built `StandingsRow[]`.
describe("standings projection (PRD #1628 stories 22-24/47, issue #1643)", () => {
    it("projects a zeroed standings row per seat for an event with no rounds yet", () => {
        const view = projectLimitedEvent(row(), "user1");
        expect(view.standings).toHaveLength(2);
        for (const seatRow of view.standings) {
            expect(seatRow.points).toBe(0);
            expect(seatRow.matchWins).toBe(0);
            expect(seatRow.gameWinPct).toBe(0);
            expect(seatRow.opponentMatchWinPct).toBe(0);
        }
    });

    it("computes standings from the event's recorded rounds, visible to every viewer", () => {
        const event = row({
            status: "playing",
            currentRound: 1,
            rounds: [
                {
                    roundNumber: 1,
                    startedAt: 0,
                    pairings: [
                        {
                            seatA: 0,
                            seatB: 1,
                            result: { winsA: 2, winsB: 0, source: "played" },
                        },
                    ],
                },
            ],
        });
        for (const viewer of ["user1", "user2", null]) {
            const view = projectLimitedEvent(event, viewer);
            const winner = view.standings.find((r) => r.seatIndex === 0)!;
            const loser = view.standings.find((r) => r.seatIndex === 1)!;
            expect(winner.points).toBe(3);
            expect(winner.matchWins).toBe(1);
            expect(winner.gameWins).toBe(2);
            expect(loser.points).toBe(0);
            expect(loser.matchLosses).toBe(1);
        }
        // Sorted: the winner comes first (higher points).
        const view = projectLimitedEvent(event, "user1");
        expect(view.standings[0].seatIndex).toBe(0);
    });

    it("counts a bye and a timeout the same way through the projection as the pure module", () => {
        const event = row({
            status: "finished",
            currentRound: 1,
            rounds: [
                {
                    roundNumber: 1,
                    startedAt: 0,
                    pairings: [
                        {
                            seatA: 0,
                            result: { winsA: 2, winsB: 0, source: "bye" },
                        },
                    ],
                },
            ],
        });
        const view = projectLimitedEvent(event, "user1");
        const byeSeat = view.standings.find((r) => r.seatIndex === 0)!;
        expect(byeSeat.points).toBe(3);
        expect(byeSeat.matchWins).toBe(1);
        expect(byeSeat.gameWins).toBe(2);
    });
});

describe("projectLimitedEvent — seed exposure (issue #1613, ADR 0074 replay mode)", () => {
    it("hides seed while the event is still running (completed = false)", () => {
        const event = row({ seed: 42 });
        const view = projectLimitedEvent(event, "user1", false);
        expect(view.seed).toBeNull();
    });

    it("hides seed for every viewer while running, not just non-participants", () => {
        const event = row({ seed: 42 });
        // Even the seated participant, and even a null (unauthenticated)
        // viewer, must not receive the seed before the draft is over — a
        // live seat could otherwise compute the packs it is about to be
        // passed from the seed alone.
        for (const viewer of ["user1", "user2", "outsider", null]) {
            const view = projectLimitedEvent(event, viewer, false);
            expect(view.seed).toBeNull();
        }
    });

    it("exposes seed once the event is completed — hides nothing once the draft is over", () => {
        const event = row({ seed: 42 });
        const view = projectLimitedEvent(event, "user1", true);
        expect(view.seed).toBe(42);
    });

    it("exposes seed at completion to every viewer, not just an admin", () => {
        const event = row({ seed: 42 });
        for (const viewer of ["user1", "user2", "outsider", null]) {
            const view = projectLimitedEvent(
                event,
                viewer,
                true,
                0,
                new Map(),
                new Set(),
                false // isAdmin: false
            );
            expect(view.seed).toBe(42);
        }
    });

    it("projects seed as null (not undefined) for a completed event with no stored seed", () => {
        const event = row();
        delete event.seed;
        const view = projectLimitedEvent(event, "user1", true);
        expect(view.seed).toBeNull();
    });

    it("projects scorerVersion unconditionally — not gated on completed", () => {
        const event = row({ scorerVersion: 3 });
        expect(projectLimitedEvent(event, "user1", false).scorerVersion).toBe(
            3
        );
        expect(projectLimitedEvent(event, "user1", true).scorerVersion).toBe(3);
    });

    it("scorerVersion is undefined (unknown), not 0, for an event predating the field", () => {
        const event = row();
        const view = projectLimitedEvent(event, "user1", true);
        expect(view.scorerVersion).toBeUndefined();
    });
});
