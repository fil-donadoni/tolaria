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

    // --- Direction 2: AFTER completion — every seat's Pool AND humanDeck
    // (human seats only) are revealed, to ANY viewer (participant or not).
    // This is the "reveals at completion" half of the mandatory test.
    it("after completion: every OTHER seat's pool is revealed too", () => {
        const view = projectLimitedEvent(row(), "user1", true, 2, humanDecks);
        expect(view.completed).toBe(true);
        expect(view.seatsWithDeck).toBe(2);
        const other = view.seats.find((s) => s.seatIndex === 1)!;
        expect(other.pool).toEqual([
            { scryfallId: "s3", cardId: "c3", cardName: "Card Three" },
        ]);
    });

    it("after completion: a human seat's submitted deck is revealed via humanDeck", () => {
        const view = projectLimitedEvent(row(), "user1", true, 2, humanDecks);
        const seat0 = view.seats.find((s) => s.seatIndex === 0)!;
        expect(seat0.humanDeck).toEqual({
            cards: [{ cardId: "c1", cardName: "Card One" }],
            sideboard: [{ cardId: "c2", cardName: "Card Two" }],
            colors: ["W"],
        });
    });

    it("after completion: a human seat with no entry in humanDecksBySeat reveals humanDeck: null (never throws)", () => {
        const view = projectLimitedEvent(row(), "user1", true, 1, humanDecks);
        const seat1 = view.seats.find((s) => s.seatIndex === 1)!;
        expect(seat1.humanDeck).toBeNull();
        expect(seat1.pool).not.toBeNull(); // pool itself still reveals regardless
    });

    it("after completion: a bot seat's humanDeck is always null (its deck is autoBuiltDeck, computed elsewhere)", () => {
        const withBot = row({
            seats: [
                row().seats[0],
                { seatIndex: 1, isBot: true, nickname: "Bot 2", pool: [] },
            ],
        });
        const view = projectLimitedEvent(withBot, "user1", true, 1);
        const botSeat = view.seats.find((s) => s.seatIndex === 1)!;
        expect(botSeat.isBot).toBe(true);
        expect(botSeat.humanDeck).toBeNull();
    });

    it("after completion: reveal reaches a NON-PARTICIPANT viewer too (post-mortem study, not participant-gated)", () => {
        const view = projectLimitedEvent(
            row(),
            "outsider",
            true,
            2,
            humanDecks
        );
        expect(view.seats.every((s) => !s.isViewer)).toBe(true);
        expect(view.seats.every((s) => s.pool !== null)).toBe(true);
        expect(
            view.seats.find((s) => s.seatIndex === 0)!.humanDeck
        ).not.toBeNull();
    });

    it("after completion: reveal reaches a null (unauthenticated/defensive) viewer too", () => {
        const view = projectLimitedEvent(row(), null, true, 2, humanDecks);
        expect(view.seats.every((s) => s.pool !== null)).toBe(true);
    });

    it("for a DRAFT event, the revealed pool's array order IS the seat's pick order — never reordered by the projection", () => {
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
        const view = projectLimitedEvent(draft, "someone-else", true, 1);
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

        const view = projectLimitedEvent(event, "outsider-user", true, 2);
        const alice = view.seats.find((s) => s.seatIndex === 0)!;
        expect(alice.selectedPickId).toBeNull();
        // The Pool itself DOES reveal post-completion — proves the strip is
        // specific to `selectedPickId`, not an accidental full lockdown.
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
