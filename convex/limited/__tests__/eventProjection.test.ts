// Event projection privacy tests (PRD #1107 story 15/26, ADR 0054/0055, issue
// #1110). This is the "wire format" mandatory test for the privacy boundary:
// assertions run against `projectLimitedEvent`'s OUTPUT — the same seam a
// client actually receives — not a hand-built view.
import { describe, it, expect } from "vitest";
import {
    areOtherSeatsRevealed,
    projectLimitedEvent,
    type LimitedEventRow,
} from "../eventProjection";

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

describe("projectLimitedEvent — revelation rule (issue #5386, PRD #5383)", () => {
    const humanDecks = new Map([
        [
            0,
            {
                cards: [{ cardId: "c1", cardName: "Card One" }],
                sideboard: [{ cardId: "c2", cardName: "Card Two" }],
                colors: ["W"],
            },
        ],
        [
            1,
            {
                cards: [{ cardId: "c3", cardName: "Card Three" }],
                sideboard: [],
                colors: ["U"],
            },
        ],
    ]);
    const allDecks = new Set([0, 1]);

    // A non-admin participant (user1, seat 0) looking at seat 1 — the viewer
    // every rule below is about. `completed` is true throughout: once every
    // seat has a deck it stays true through the Play Phase, so the rule must
    // be decided by status + Open Decklists, never by `completed`.
    function otherSeat(overrides: Partial<LimitedEventRow>) {
        const view = projectLimitedEvent(
            row(overrides),
            "user1",
            true,
            2,
            humanDecks,
            allDecks
        );
        return view.seats.find((s) => s.seatIndex === 1)!;
    }

    it("areOtherSeatsRevealed: finished always; playing only with Open Decklists; never open/started", () => {
        expect(areOtherSeatsRevealed("open", true)).toBe(false);
        expect(areOtherSeatsRevealed("started", true)).toBe(false);
        expect(areOtherSeatsRevealed("playing", true)).toBe(true);
        expect(areOtherSeatsRevealed("playing", false)).toBe(false);
        expect(areOtherSeatsRevealed("finished", false)).toBe(true);
        expect(areOtherSeatsRevealed("finished", true)).toBe(true);
    });

    it("hidden during the Draft even with Open Decklists", () => {
        const other = otherSeat({
            type: "draft",
            status: "started",
            openDecklists: true,
        });
        expect(other.pool).toBeNull();
        expect(other.humanDeck).toBeNull();
    });

    it("visible from the Play Phase with Open Decklists, to a non-admin", () => {
        const other = otherSeat({ status: "playing", openDecklists: true });
        expect(other.pool).toEqual([
            { scryfallId: "s3", cardId: "c3", cardName: "Card Three" },
        ]);
        expect(other.humanDeck).toEqual(humanDecks.get(1));
    });

    it("hidden in the Play Phase without Open Decklists — admin or not", () => {
        expect(otherSeat({ status: "playing" }).pool).toBeNull();
        expect(otherSeat({ status: "playing" }).humanDeck).toBeNull();
        const adminView = projectLimitedEvent(
            row({ status: "playing", openDecklists: false }),
            "user1",
            true,
            2,
            humanDecks,
            allDecks,
            true // isAdmin — the #1583 admin gate is gone
        );
        const adminOther = adminView.seats.find((s) => s.seatIndex === 1)!;
        expect(adminOther.pool).toBeNull();
        expect(adminOther.humanDeck).toBeNull();
    });

    it("everything (pool, pick order, built deck) visible to a non-admin at a finished event — legacy row without the setting", () => {
        const draft = row({
            type: "draft",
            status: "finished",
            packSlots: ["lea", "lea"],
            draftCompletedAt: 999,
            seats: [
                row().seats[0],
                {
                    seatIndex: 1,
                    userId: "user2",
                    nickname: "Bob",
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
        });
        const view = projectLimitedEvent(
            draft,
            "user1",
            true,
            2,
            humanDecks,
            allDecks
        );
        expect(view.openDecklists).toBe(false);
        const other = view.seats.find((s) => s.seatIndex === 1)!;
        // A Draft seat's pool order IS its pick order — never reordered.
        expect(other.pool!.map((c) => c.cardName)).toEqual([
            "First Pick",
            "Second Pick",
            "Third Pick",
        ]);
        expect(other.humanDeck).toEqual(humanDecks.get(1));
    });

    it("a finished event reveals every seat to a non-participant too", () => {
        const view = projectLimitedEvent(
            row({ status: "finished" }),
            "outsider",
            true,
            2,
            humanDecks,
            allDecks
        );
        expect(view.seats.every((s) => !s.isViewer)).toBe(true);
        expect(view.seats.every((s) => s.pool !== null)).toBe(true);
        expect(view.seats.every((s) => s.humanDeck !== null)).toBe(true);
    });

    it("the viewer's own seat is always fully visible — pool and built deck — even during the Draft", () => {
        for (const status of ["started", "playing", "finished"] as const) {
            const view = projectLimitedEvent(
                row({ status }),
                "user1",
                false,
                1,
                humanDecks
            );
            const own = view.seats.find((s) => s.seatIndex === 0)!;
            expect(own.isViewer).toBe(true);
            expect(own.pool).toEqual(row().seats[0].pool);
            expect(own.humanDeck).toEqual(humanDecks.get(0));
        }
    });

    it("projects openDecklists definite on the wire: true when stored, false when absent", () => {
        expect(
            projectLimitedEvent(row({ openDecklists: true }), "user1")
                .openDecklists
        ).toBe(true);
        expect(projectLimitedEvent(row(), "user1").openDecklists).toBe(false);
    });

    it("a call site that forgets the extra params defaults to not-completed and hides other seats", () => {
        const view = projectLimitedEvent(row(), "user1");
        expect(view.completed).toBe(false);
        expect(view.seatsWithDeck).toBe(0);
        expect(view.seats.find((s) => s.seatIndex === 1)!.pool).toBeNull();
    });

    it("a human seat with no submitted deck reveals humanDeck: null (never throws)", () => {
        const view = projectLimitedEvent(
            row({ status: "finished" }),
            "user1",
            false,
            1,
            new Map([[0, humanDecks.get(0)!]])
        );
        const seat1 = view.seats.find((s) => s.seatIndex === 1)!;
        expect(seat1.humanDeck).toBeNull();
        expect(seat1.pool).not.toBeNull();
    });

    it("a bot seat's humanDeck is always null (its deck is autoBuiltDeck, computed elsewhere)", () => {
        const withBot = row({
            status: "finished",
            seats: [
                row().seats[0],
                { seatIndex: 1, isBot: true, nickname: "Bot 2", pool: [] },
            ],
        });
        const view = projectLimitedEvent(withBot, "user1", true, 1, new Map());
        const botSeat = view.seats.find((s) => s.seatIndex === 1)!;
        expect(botSeat.isBot).toBe(true);
        expect(botSeat.humanDeck).toBeNull();
    });

    it("every viewer still gets each seat's compact deckSummary (colors + counts) while the card lists stay hidden (issue #1583)", () => {
        const view = projectLimitedEvent(
            row({ status: "playing" }),
            "outsider",
            true,
            2,
            new Map([[0, humanDecks.get(0)!]])
        );
        const seat0 = view.seats.find((s) => s.seatIndex === 0)!;
        expect(seat0.deckSummary).toEqual({
            colors: ["W"],
            maindeckCount: 1,
            sideboardCount: 1,
        });
        expect(seat0.pool).toBeNull();
        expect(seat0.humanDeck).toBeNull();
        expect(
            view.seats.find((s) => s.seatIndex === 1)!.deckSummary
        ).toBeNull();
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
            status: "finished",
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
            true // admin
        );
        const alice = view.seats.find((s) => s.seatIndex === 0)!;
        expect(alice.selectedPickId).toBeNull();
        // The Pool itself DOES reveal at a finished event — proves the
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

describe("projectLimitedEvent — defaultPickId / unattendedPickIndices (ADR 0095, issue #2271)", () => {
    it("preserves the viewer's own seat's Default Pick and Unattended Pick marks", () => {
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
                    defaultPickId: "r0-p0-c0",
                    unattendedPickIndices: [2, 5],
                },
                { seatIndex: 1, userId: "user2", nickname: "Bob", pool: [] },
            ],
        });

        const view = projectLimitedEvent(event, "user1");
        const own = view.seats.find((s) => s.seatIndex === 0)!;
        expect(own.defaultPickId).toBe("r0-p0-c0");
        expect(own.unattendedPickIndices).toEqual([2, 5]);
    });

    it("strips every OTHER seat's Default Pick and Unattended Pick marks — same 'own seat only' discipline as currentPack/pickDeadline/selectedPickId", () => {
        const event = row({
            type: "draft",
            seats: [
                {
                    seatIndex: 0,
                    userId: "user1",
                    nickname: "Alice",
                    pool: [],
                    defaultPickId: "r0-p0-c0",
                    unattendedPickIndices: [1],
                },
                {
                    seatIndex: 1,
                    userId: "user2",
                    nickname: "Bob",
                    pool: [],
                    defaultPickId: "r0-p1-c0",
                    unattendedPickIndices: [3],
                },
            ],
        });

        const view = projectLimitedEvent(event, "user1");
        const other = view.seats.find((s) => s.seatIndex === 1)!;
        expect(other.defaultPickId).toBeNull();
        expect(other.unattendedPickIndices).toBeNull();
    });

    it("stays stripped for a NON-participant admin viewer too, even post-completion (unlike pool)", () => {
        const event = row({
            type: "draft",
            status: "finished",
            draftCompletedAt: 999,
            seats: [
                {
                    seatIndex: 0,
                    userId: "user1",
                    nickname: "Alice",
                    pool: [],
                    defaultPickId: "r0-p0-c0",
                    unattendedPickIndices: [0],
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
            true // admin
        );
        const alice = view.seats.find((s) => s.seatIndex === 0)!;
        expect(alice.defaultPickId).toBeNull();
        expect(alice.unattendedPickIndices).toBeNull();
        expect(alice.pool).not.toBeNull();
    });

    it("projects both to null for a viewer's own seat with nothing stamped", () => {
        const event = row({
            type: "draft",
            seats: [
                { seatIndex: 0, userId: "user1", nickname: "Alice", pool: [] },
                { seatIndex: 1, userId: "user2", nickname: "Bob", pool: [] },
            ],
        });
        const view = projectLimitedEvent(event, "user1");
        const own = view.seats.find((s) => s.seatIndex === 0)!;
        expect(own.defaultPickId).toBeNull();
        expect(own.unattendedPickIndices).toBeNull();
    });
});

// --- Play phase on the wire (PRD #1628, ADR 0076, issue #1640) -------------
// The mandatory wire-format assertions for the play-phase fields: every one is
// checked against `projectLimitedEvent`'s OUTPUT — the exact object a client
// receives — because a field the projection drops is this project's single
// most recurring bug class, and a hand-built view would mask it entirely.
describe("play phase projection (PRD #1628, ADR 0076, issue #1640)", () => {
    it("defaults an absent gamesFormat to Bo3 on the wire (never undefined)", () => {
        // An event created before the play phase existed: the stored field is
        // absent, but the client must still receive a concrete format.
        const view = projectLimitedEvent(row(), "user1");
        expect(view.gamesFormat).toBe("bo3");
    });

    it("carries an explicitly chosen Bo1 through the projection", () => {
        const view = projectLimitedEvent(row({ gamesFormat: "bo1" }), "user1");
        expect(view.gamesFormat).toBe("bo1");
    });

    it("carries an explicitly chosen Bo3 through the projection", () => {
        const view = projectLimitedEvent(row({ gamesFormat: "bo3" }), "user1");
        expect(view.gamesFormat).toBe("bo3");
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

describe("projectLimitedEvent — seed exposure (issue #1613, ADR 0074 replay mode; tightened by the #1613 fixup)", () => {
    // Every call below passes `type: "draft"` explicitly except the
    // dedicated Sealed-leak tests, since `row()`'s default `type` is
    // "sealed" — a completed Sealed event getting the seed unconditionally
    // was the leak this fixup closes (BLOCKING 1), so a Draft-only default
    // would silently mask a regression back to that behavior.

    it("hides seed while a Draft event is still running, even for an admin", () => {
        const event = row({ type: "draft", seed: 42 });
        const view = projectLimitedEvent(
            event,
            "user1",
            false, // completed
            0,
            new Map(),
            new Set(),
            true // isAdmin
        );
        expect(view.seed).toBeNull();
    });

    it("hides seed for every viewer while a Draft event is running, not just non-participants", () => {
        const event = row({ type: "draft", seed: 42 });
        // Even the seated participant, and even a null (unauthenticated)
        // viewer, must not receive the seed before the draft is over — a
        // live seat could otherwise compute the packs it is about to be
        // passed from the seed alone.
        for (const viewer of ["user1", "user2", "outsider", null]) {
            const view = projectLimitedEvent(event, viewer, false);
            expect(view.seed).toBeNull();
        }
    });

    it("exposes seed for a finished Draft event ONLY to an admin viewer", () => {
        const event = row({ type: "draft", status: "finished", seed: 42 });
        const admin = projectLimitedEvent(
            event,
            "user1",
            true, // completed
            0,
            new Map(),
            new Set(),
            true // isAdmin
        );
        expect(admin.seed).toBe(42);
    });

    it("hides seed for a finished Draft event from every NON-admin viewer, including a seated participant", () => {
        const event = row({ type: "draft", status: "finished", seed: 42 });
        for (const viewer of ["user1", "user2", "outsider", null]) {
            const view = projectLimitedEvent(
                event,
                viewer,
                true, // completed
                0,
                new Map(),
                new Set(),
                false // isAdmin
            );
            expect(view.seed).toBeNull();
        }
    });

    it("BLOCKING 1 regression: hides seed for a completed SEALED event even from an admin", () => {
        // `generateSealedPools` (`eventLogic.ts`) is a pure function of
        // `makeRng(seed)` + `packSlots` + `sealedBoosterCount` — both project
        // unconditionally — so exposing the seed here would let ANY viewer
        // regenerate EVERY seat's exact Pool client-side, defeating the
        // admin gate on `pool`/`humanDeck` (issue #1583). Sealed has no
        // picks/passing for the Draft Lab replay surface to reconstruct
        // anyway, so there is nothing legitimate for it to expose the seed
        // for.
        const event = row({ type: "sealed", seed: 42 });
        for (const viewer of ["user1", "user2", "outsider", null]) {
            const view = projectLimitedEvent(
                event,
                viewer,
                true, // completed
                0,
                new Map(),
                new Set(),
                true // isAdmin
            );
            expect(view.seed).toBeNull();
        }
    });

    it("BLOCKING 1 regression: hides seed for a RUNNING sealed event's play phase (completed stays true through PRD #1628's play phase)", () => {
        // `completed` means "every seat has a Deck", not "the event is
        // over" — PRD #1628's play phase keeps it true while rounds are
        // still being played. An unconditional-at-completion reveal would
        // leak every opponent's full Pool while matches are still live, not
        // just once the event is fully finished.
        const event = row({
            type: "sealed",
            seed: 42,
            status: "started",
            currentRound: 1,
            rounds: [],
        });
        const view = projectLimitedEvent(
            event,
            "user1",
            true, // completed (every seat already has a deck)
            2,
            new Map(),
            new Set(),
            true // isAdmin
        );
        expect(view.seed).toBeNull();
    });

    it("hides seed and cubePool from an admin while the event's pools are still hidden (completed, Play Phase, no Open Decklists — issue #5386)", () => {
        const event = row({
            type: "draft",
            status: "playing",
            seed: 42,
            cubePool: ["c1"],
        });
        const view = projectLimitedEvent(
            event,
            "user1",
            true, // completed
            0,
            new Map(),
            new Set(),
            true // isAdmin
        );
        expect(view.seed).toBeNull();
        expect(view.cubePool).toBeNull();
    });

    it("projects seed as null (not undefined) for a completed Draft event an admin views with no stored seed", () => {
        const event = row({ type: "draft", status: "finished" });
        delete event.seed;
        const view = projectLimitedEvent(
            event,
            "user1",
            true, // completed
            0,
            new Map(),
            new Set(),
            true // isAdmin
        );
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

// ─────────────────────────────────────────────────────────────────────────────
// The viewer's own pairing (PRD #1628 story 7, issue #1644). Asserted THROUGH
// `projectLimitedEvent` — the seam the client actually receives — never against
// a hand-built view (CLAUDE.md § Frontend wiring analysis).
// ─────────────────────────────────────────────────────────────────────────────

/** A 4-seat table mid-play-phase: seat 0 (Alice, human) vs seat 2 (a bot),
 *  seat 1 (Bob, human) vs seat 3 (a bot). */
function playingRow(
    pairings: NonNullable<LimitedEventRow["rounds"]>[number]["pairings"],
    overrides: Partial<LimitedEventRow> = {}
): LimitedEventRow {
    return row({
        status: "playing",
        seatCount: 4,
        currentRound: 1,
        seats: [
            { seatIndex: 0, userId: "user1", nickname: "Alice" },
            { seatIndex: 1, userId: "user2", nickname: "Bob" },
            { seatIndex: 2, nickname: "Bot 3", isBot: true },
            { seatIndex: 3, nickname: "Bot 4", isBot: true },
        ],
        rounds: [{ roundNumber: 1, startedAt: 1000, pairings }],
        ...overrides,
    });
}

describe("projectLimitedEvent — viewerPairing (PRD #1628 story 7, issue #1644)", () => {
    it("gives the viewer their own pairing, with the opponent named and flagged bot", () => {
        const view = projectLimitedEvent(
            playingRow([
                { seatA: 0, seatB: 2 },
                { seatA: 1, seatB: 3 },
            ]),
            "user1"
        );

        expect(view.viewerPairing).toEqual({
            roundNumber: 1,
            seatIndex: 0,
            opponentSeatIndex: 2,
            opponentNickname: "Bot 3",
            opponentIsBot: true,
            isBye: false,
            result: null,
            gameWins: null,
            gameLosses: null,
            outcome: null,
            matchId: null,
            roundComplete: false,
        });
    });

    it("finds the viewer's pairing from the seatB side too", () => {
        const view = projectLimitedEvent(
            playingRow([
                { seatA: 2, seatB: 0 },
                { seatA: 1, seatB: 3 },
            ]),
            "user1"
        );

        expect(view.viewerPairing?.seatIndex).toBe(0);
        expect(view.viewerPairing?.opponentSeatIndex).toBe(2);
    });

    it("flags a human opponent as human", () => {
        const view = projectLimitedEvent(
            playingRow([
                { seatA: 0, seatB: 1 },
                { seatA: 2, seatB: 3 },
            ]),
            "user1"
        );

        expect(view.viewerPairing?.opponentIsBot).toBe(false);
        expect(view.viewerPairing?.opponentNickname).toBe("Bob");
    });

    it("reads a decided pairing from the viewer's own side", () => {
        const decided = (pairings: Parameters<typeof playingRow>[0]) =>
            projectLimitedEvent(playingRow(pairings), "user1").viewerPairing;

        expect(
            decided([
                {
                    seatA: 0,
                    seatB: 2,
                    result: { winsA: 2, winsB: 1, source: "played" },
                },
                {
                    seatA: 1,
                    seatB: 3,
                    result: { winsA: 0, winsB: 2, source: "simulated" },
                },
            ])
        ).toMatchObject({ outcome: "win", roundComplete: true });

        expect(
            decided([
                {
                    seatA: 2,
                    seatB: 0,
                    result: { winsA: 2, winsB: 0, source: "played" },
                },
                { seatA: 1, seatB: 3 },
            ])
        ).toMatchObject({ outcome: "loss", roundComplete: false });
    });

    it("reads a double no-show timeout as a LOSS for the viewer, never a draw", () => {
        const view = projectLimitedEvent(
            playingRow([
                {
                    seatA: 0,
                    seatB: 1,
                    result: { winsA: 0, winsB: 0, source: "timeout" },
                },
                { seatA: 2, seatB: 3 },
            ]),
            "user1"
        );

        expect(view.viewerPairing?.outcome).toBe("loss");
    });

    it("surfaces a bye as a decided win with no opponent", () => {
        const view = projectLimitedEvent(
            playingRow([
                {
                    seatA: 0,
                    result: { winsA: 2, winsB: 0, source: "bye" },
                },
                { seatA: 1, seatB: 2 },
                { seatA: 3 },
            ]),
            "user1"
        );

        expect(view.viewerPairing).toMatchObject({
            isBye: true,
            opponentSeatIndex: null,
            opponentNickname: null,
            opponentIsBot: false,
            outcome: "win",
            result: { winsA: 2, winsB: 0, source: "bye" },
        });
    });

    it("carries result.source so the UI can explain how it was decided", () => {
        const view = projectLimitedEvent(
            playingRow([
                {
                    seatA: 0,
                    seatB: 2,
                    result: { winsA: 1, winsB: 2, source: "simulated" },
                },
                { seatA: 1, seatB: 3 },
            ]),
            "user1"
        );

        expect(view.viewerPairing?.result?.source).toBe("simulated");
    });

    it("is null before the play phase, and for a viewer with no seat", () => {
        expect(projectLimitedEvent(row(), "user1").viewerPairing).toBeNull();
        expect(
            projectLimitedEvent(
                playingRow([
                    { seatA: 0, seatB: 2 },
                    { seatA: 1, seatB: 3 },
                ]),
                "outsider"
            ).viewerPairing
        ).toBeNull();
        expect(
            projectLimitedEvent(
                playingRow([
                    { seatA: 0, seatB: 2 },
                    { seatA: 1, seatB: 3 },
                ]),
                null
            ).viewerPairing
        ).toBeNull();
    });

    it("is null when currentRound names a round that isn't there", () => {
        const view = projectLimitedEvent(
            playingRow([{ seatA: 0, seatB: 2 }], { currentRound: 7 }),
            "user1"
        );
        expect(view.viewerPairing).toBeNull();
    });

    it("is null when the viewer's seat isn't in the current round at all", () => {
        const view = projectLimitedEvent(
            playingRow([{ seatA: 1, seatB: 3 }]),
            "user1"
        );
        expect(view.viewerPairing).toBeNull();
    });
});

describe("projectLimitedEvent — viewerPairing game score (issue #1644)", () => {
    it("reports the games from the VIEWER's side, whichever seat letter they are", () => {
        const asSeatA = projectLimitedEvent(
            playingRow([
                {
                    seatA: 0,
                    seatB: 2,
                    result: { winsA: 2, winsB: 1, source: "played" },
                },
                { seatA: 1, seatB: 3 },
            ]),
            "user1"
        ).viewerPairing;
        expect(asSeatA).toMatchObject({ gameWins: 2, gameLosses: 1 });

        const asSeatB = projectLimitedEvent(
            playingRow([
                {
                    seatA: 2,
                    seatB: 0,
                    result: { winsA: 2, winsB: 1, source: "played" },
                },
                { seatA: 1, seatB: 3 },
            ]),
            "user1"
        ).viewerPairing;
        // Same raw 2-1, opposite side: the viewer LOST it 1-2.
        expect(asSeatB).toMatchObject({
            gameWins: 1,
            gameLosses: 2,
            outcome: "loss",
        });
    });

    it("reports a bye's games from the viewer's side too", () => {
        const view = projectLimitedEvent(
            playingRow([
                { seatA: 0, result: { winsA: 2, winsB: 0, source: "bye" } },
                { seatA: 1, seatB: 2 },
                { seatA: 3 },
            ]),
            "user1"
        );
        expect(view.viewerPairing).toMatchObject({
            gameWins: 2,
            gameLosses: 0,
        });
    });
});
