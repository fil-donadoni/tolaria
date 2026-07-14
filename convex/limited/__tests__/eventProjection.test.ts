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
